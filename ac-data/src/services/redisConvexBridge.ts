import '../config/loadEnv.js';
import type { RedisClientType } from 'redis';
import {
  coalesceIngestBatch,
  pendingHasPlayerJoin,
  shouldFlushIngestBuffer,
  WORKER_INGEST_FLUSH_INTERVAL_MS,
  WORKER_INGEST_MAX_BATCH_SIZE,
  type PendingIngestMessage,
} from './coalesceIngestBatch.js';
import { ensureConvexClient, isConvexConfigured } from './convexClient.js';
import { publishWorkerErrorEvent } from './activity/activityService.js';
import {
  handleEventAfterIngest,
  handleEventBeforeIngest,
  handlePlayerJoinBeforeIngest,
} from './eventHandlers/index.js';
import { partitionCoalescedByIngestPrefs } from './ingestPrefPartition.js';
import { buildIngestEvent } from './ingestEventBuilder.js';
import {
  isNonRetryableIngestError,
  partitionIngestResults,
  resolveChunkAckPlan,
  type IngestBatchResult,
} from './ingestBatchAck.js';
import { connectRedisClient, createRedisClient, isRedisConfigured } from './redisClient.js';
import { bindConfigSyncRedisClient, startConvexConfigPublisher } from './configSyncFromConvex.js';

export { ingestBatchSucceeded } from './ingestBatchAck.js';

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'ac:events';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

// All VPS in the fleet should share the same group so Redis load-balances
// events across them (each event processed exactly once, no SPOF). The
// consumer name MUST be unique per VPS, so default it to AC_INSTANCE_ID.
const GROUP = process.env.REDIS_CONSUMER_GROUP || 'ac-data-consumers';
const CONSUMER =
  process.env.REDIS_CONSUMER_NAME || `ac-data-${AC_INSTANCE_ID}`;

const CONVEX_MUTATION_BATCH =
  process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
const CONVEX_INGEST_SECRET = (process.env.CONVEX_INGEST_SECRET || '').trim();
const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const PENDING_RECLAIM_MIN_IDLE_MS = Number(process.env.REDIS_PENDING_RECLAIM_MIN_IDLE_MS || 60_000);
const PENDING_RECLAIM_BATCH = Number(process.env.REDIS_PENDING_RECLAIM_BATCH || 50);
const REDIS_CONFIG_SYNC_ENABLED =
  (process.env.REDIS_CONFIG_SYNC_ENABLED || 'true').trim().toLowerCase() === 'true';
// Recommended: keep enabled on every VPS sharing the same REDIS_CONSUMER_GROUP.
// Redis load-balances events across consumers (no duplicates, no SPOF).
// Set to false on a node only if you want a single-primary topology.
const REDIS_EVENTS_BRIDGE_ENABLED =
  (process.env.REDIS_EVENTS_BRIDGE_ENABLED || 'true').trim().toLowerCase() === 'true';
const INGEST_MAX_BATCH_SIZE = Number(
  process.env.WORKER_INGEST_MAX_BATCH_SIZE || WORKER_INGEST_MAX_BATCH_SIZE,
);
const INGEST_FLUSH_INTERVAL_MS = Number(
  process.env.WORKER_INGEST_FLUSH_INTERVAL_MS || WORKER_INGEST_FLUSH_INTERVAL_MS,
);
const REDIS_INGEST_READ_COUNT = Number(process.env.REDIS_INGEST_READ_COUNT || INGEST_MAX_BATCH_SIZE);

type StreamMessage = {
  id: string;
  fields?: Record<string, string>;
  message?: Record<string, string>;
};

type StreamReadResult = Array<{
  name: string;
  messages: StreamMessage[];
}>;

const CONFIG_ONLY_EVENTS = new Set<string>([
  'server_config_snapshot',
  'server_config_applied',
  'worker_error',
]);

const PENDING_RECLAIM_INTERVAL_MS = Number(process.env.REDIS_PENDING_RECLAIM_INTERVAL_MS || 310_000);

function parseIngestBatchResult(raw: unknown): IngestBatchResult {
  if (!raw || typeof raw !== 'object') return {};
  return raw as IngestBatchResult;
}

function parsePayload(message: StreamMessage): Record<string, unknown> | null {
  const raw = message.fields?.payload ?? message.message?.payload;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function forwardBatchToConvex(
  payloads: Record<string, unknown>[],
): Promise<IngestBatchResult> {
  if (!CONVEX_INGEST_SECRET) {
    throw new Error('CONVEX_INGEST_SECRET missing for direct mode');
  }
  if (payloads.length === 0) {
    return { ok: true, processed: 0, failed: 0, results: [] };
  }

  const { mutation } = ensureConvexClient();
  const mutationArgs = {
    ingestSecret: CONVEX_INGEST_SECRET,
    events: payloads.map(buildIngestEvent),
  };

  const raw = await mutation(CONVEX_MUTATION_BATCH, mutationArgs);
  return parseIngestBatchResult(raw);
}

type IngestBufferState = {
  items: PendingIngestMessage[];
  startedAt: number | null;
};

function appendToIngestBuffer(state: IngestBufferState, items: PendingIngestMessage[]): void {
  if (items.length === 0) {
    return;
  }
  if (state.startedAt === null) {
    state.startedAt = Date.now();
  }
  state.items.push(...items);
}

/** Force the coalesce timer so player_join batches flush immediately. */
function markIngestBufferFlushReady(state: IngestBufferState): void {
  if (state.items.length > 0) {
    state.startedAt = Date.now() - INGEST_FLUSH_INTERVAL_MS - 1;
  }
}

async function onPlayerJoinMessagesRead(items: PendingIngestMessage[]): Promise<void> {
  for (const { payload, event } of items) {
    if (event === 'player_join') {
      await handlePlayerJoinBeforeIngest(payload);
    }
  }
}

/**
 * Flush one chunk to Convex. Returns messages that must stay in the buffer
 * (retryable failures). Empty array means the chunk was fully resolved.
 */
async function flushIngestChunk(
  client: RedisClientType,
  chunk: PendingIngestMessage[],
): Promise<PendingIngestMessage[]> {
  const coalesced = coalesceIngestBatch(chunk);
  const droppedStatus = chunk.length - coalesced.length;
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(coalesced);

  for (const { payload, event } of forward) {
    if (event === 'lap_completed') {
      const lapData = (payload.data ?? {}) as Record<string, unknown>;
      const steamId = typeof lapData.steamId === 'string' ? lapData.steamId : '?';
      const serverName = typeof payload.serverName === 'string' ? payload.serverName : '?';
      console.log(
        `[redis-bridge] lap_completed forward steamId=${steamId} server=${serverName}`,
      );
    }
    await handleEventBeforeIngest(event, payload);
  }

  const ingestResult =
    forward.length > 0
      ? await forwardBatchToConvex(forward.map((p) => p.payload))
      : { ok: true, processed: 0, failed: 0, results: [] };
  const partitioned = partitionIngestResults(forward, ingestResult);
  const localOnlyIds = new Set(localOnly.map((m) => m.msg.id));
  const { toAck, toRetry: plannedRetry } = resolveChunkAckPlan(chunk, forward, partitioned);
  const toRetry =
    forward.length === 0
      ? []
      : plannedRetry.filter((m) => !localOnlyIds.has(m.msg.id));
  const ackIds = new Set(toAck.map((m) => m.msg.id));

  if (localOnly.length > 0) {
    const localOnlyTypes = [...new Set(localOnly.map((m) => m.event))];
    console.log(
      `[redis-bridge] skipped Convex ingest for ${localOnly.length} event(s) (local-only): ${localOnlyTypes.join(', ')}`,
    );
  }

  if (partitioned.nonRetryableCount > 0) {
    console.warn(
      `[redis-bridge] acked ${partitioned.nonRetryableCount} non-retryable ingest error(s) (user_not_found)`,
    );
  }

  if (droppedStatus > 0 && toRetry.length === 0) {
    console.log(
      `[redis-bridge] ingested ${forward.length} events (coalesced ${droppedStatus} server_status)`,
    );
  }

  for (const { msg, payload, event } of chunk) {
    if (localOnlyIds.has(msg.id)) {
      await handleEventAfterIngest(event, payload);
      await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
      continue;
    }
    if (!ackIds.has(msg.id)) {
      continue;
    }
    const wasForwarded = forward.some((c) => c.msg.id === msg.id);
    if (wasForwarded) {
      await handleEventAfterIngest(event, payload);
    }
    await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
  }

  if (toRetry.length === 0) {
    return [];
  }

  const failedRows =
    ingestResult.results?.filter(
      (r) => r.ok !== true && !isNonRetryableIngestError(r.error),
    ) ?? [];
  const failed = failedRows[0];
  const retryEventTypes = [...new Set(toRetry.map((p) => p.event))];
  const errorMsg =
    failedRows.length > 0
      ? failedRows
          .map((r) => {
            const label = r.eventType ?? `index:${r.index ?? '?'}`;
            const detail = typeof r.error === 'string' && r.error.trim() ? r.error : 'unknown';
            return `${label}: ${detail}`;
          })
          .join('; ')
      : partitioned.unsafeMissingResults
        ? 'Convex ingest batch failed (missing per-event results)'
        : `Convex ingest batch incomplete (retry: ${retryEventTypes.join(', ')})`;
  console.error(
    '[redis-bridge] convex batch ingest failed (retrying):',
    toRetry.length,
    'of',
    forward.length,
    'events',
    droppedStatus > 0 ? `(coalesced ${droppedStatus} duplicate server_status)` : '',
    errorMsg,
  );
  void publishWorkerErrorEvent({
    error: errorMsg,
    failed: toRetry.length,
    eventTypes: [...new Set(toRetry.map((p) => p.event))],
  }).catch((publishErr) => {
    console.warn('[redis-bridge] worker_error publish failed:', publishErr);
  });

  return toRetry;
}

function formatFlushError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Reclaim stale XPENDING entries so fetch failures do not block the consumer forever. */
async function reclaimStalePendingMessages(
  client: RedisClientType,
  buffer: IngestBufferState,
): Promise<number> {
  let reclaimed = 0;
  let cursor = '0-0';

  while (reclaimed < PENDING_RECLAIM_BATCH) {
    const raw = await client.xAutoClaim(
      REDIS_STREAM_KEY,
      GROUP,
      CONSUMER,
      PENDING_RECLAIM_MIN_IDLE_MS,
      cursor,
      { COUNT: Math.min(10, PENDING_RECLAIM_BATCH - reclaimed) },
    );

    const nextCursor = raw?.nextId;
    const messages = raw?.messages as Array<{ id: string; message: Record<string, string> } | null> | undefined;
    cursor = typeof nextCursor === 'string' ? nextCursor : '0-0';

    if (!messages || messages.length === 0) {
      break;
    }

    const pending: PendingIngestMessage[] = [];
    for (const msg of messages) {
      if (!msg) {
        continue;
      }
      const streamMsg: StreamMessage = {
        id: msg.id,
        message: msg.message as Record<string, string> | undefined,
      };
      const payload = parsePayload(streamMsg);
      if (!payload) {
        await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
        continue;
      }
      const event = String(payload.event || '');
      if (CONFIG_ONLY_EVENTS.has(event)) {
        await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
        continue;
      }
      pending.push({ msg: streamMsg, payload, event });
      reclaimed += 1;
    }

    if (pending.length > 0) {
      await onPlayerJoinMessagesRead(pending);
      appendToIngestBuffer(buffer, pending);
      if (pendingHasPlayerJoin(pending)) {
        markIngestBufferFlushReady(buffer);
      }
      const eventTypes = [...new Set(pending.map((p) => p.event))];
      console.log(
        `[redis-bridge] reclaimed ${pending.length} stale pending message(s) eventTypes=[${eventTypes.join(', ')}]`,
      );
    }

    if (cursor === '0-0') {
      break;
    }
  }

  return reclaimed;
}

async function flushIngestBuffer(
  client: RedisClientType,
  state: IngestBufferState,
): Promise<void> {
  while (
    state.items.length > 0 &&
    shouldFlushIngestBuffer(
      state.items.length,
      state.startedAt,
      Date.now(),
      INGEST_MAX_BATCH_SIZE,
      INGEST_FLUSH_INTERVAL_MS,
    )
  ) {
    const take = Math.min(state.items.length, INGEST_MAX_BATCH_SIZE);
    const chunk = state.items.splice(0, take);
    const retry = await flushIngestChunk(client, chunk);
    if (retry.length > 0) {
      state.items.unshift(...retry);
      if (state.startedAt === null) {
        state.startedAt = Date.now();
      }
      break;
    }
    if (state.items.length === 0) {
      state.startedAt = null;
    }
  }
}

async function runEventsConsumerLoop(client: RedisClientType): Promise<void> {
  try {
    await client.xGroupCreate(REDIS_STREAM_KEY, GROUP, '0', { MKSTREAM: true });
    console.log(`[redis-bridge] consumer group created: ${GROUP}`);
  } catch {
    // group probably exists
  }

  const buffer: IngestBufferState = { items: [], startedAt: null };

  console.log(
    `[redis-bridge] listening stream=${REDIS_STREAM_KEY} group=${GROUP} consumer=${CONSUMER} ` +
      `batchMax=${INGEST_MAX_BATCH_SIZE} flushMs=${INGEST_FLUSH_INTERVAL_MS}`,
  );

  try {
    const reclaimed = await reclaimStalePendingMessages(client, buffer);
    if (reclaimed > 0) {
      await flushIngestBuffer(client, buffer);
    }
  } catch (err) {
    console.error('[redis-bridge] pending reclaim error:', formatFlushError(err));
  }

  let lastReclaimAt = Date.now();
  while (true) {
    try {
      const now = Date.now();
      if (now - lastReclaimAt >= PENDING_RECLAIM_INTERVAL_MS) {
        lastReclaimAt = now;
        try {
          await reclaimStalePendingMessages(client, buffer);
        } catch (err) {
          console.error('[redis-bridge] periodic pending reclaim error:', formatFlushError(err));
        }
      }

      const raw = await client.xReadGroup(
        GROUP,
        CONSUMER,
        { key: REDIS_STREAM_KEY, id: '>' },
        { COUNT: REDIS_INGEST_READ_COUNT, BLOCK: INGEST_FLUSH_INTERVAL_MS },
      );
      const results = (raw ?? null) as unknown as StreamReadResult | null;

      if (results && results.length > 0) {
        for (const stream of results) {
          const pending: PendingIngestMessage[] = [];
          for (const msg of stream.messages) {
            const payload = parsePayload(msg);
            if (!payload) {
              await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
              continue;
            }
            const event = String(payload.event || '');
            if (CONFIG_ONLY_EVENTS.has(event)) {
              await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
              continue;
            }
            pending.push({ msg, payload, event });
          }
          await onPlayerJoinMessagesRead(pending);
          appendToIngestBuffer(buffer, pending);
          if (pendingHasPlayerJoin(pending)) {
            markIngestBufferFlushReady(buffer);
          }
        }
      }

      try {
        await flushIngestBuffer(client, buffer);
      } catch (err) {
        console.error('[redis-bridge] flush error:', formatFlushError(err));
      }
    } catch (err) {
      console.error('[redis-bridge] loop error:', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function startRedisConvexBridge(): Promise<void> {
  if (!REDIS_EVENTS_BRIDGE_ENABLED && !REDIS_CONFIG_SYNC_ENABLED) {
    console.log('[redis-bridge] events bridge and config sync both disabled, skipping');
    return;
  }
  if (!isRedisConfigured()) {
    console.log('[redis-bridge] REDIS_HOST missing, bridge disabled');
    return;
  }

  const client = await connectRedisClient(createRedisClient('redis-bridge'));
  bindConfigSyncRedisClient(client);

  if (REDIS_CONFIG_SYNC_ENABLED) {
    if (!isConvexConfigured() || !CONVEX_WORKER_SECRET) {
      console.log('[redis-config-sync] missing convex env, disabled');
    } else {
      await startConvexConfigPublisher(client);
    }
  } else {
    console.log('[redis-config-sync] disabled (REDIS_CONFIG_SYNC_ENABLED=false)');
  }

  if (REDIS_EVENTS_BRIDGE_ENABLED) {
    void runEventsConsumerLoop(client);
  } else {
    console.log('[redis-bridge] events->Convex forwarding disabled (REDIS_EVENTS_BRIDGE_ENABLED=false)');
  }
}
