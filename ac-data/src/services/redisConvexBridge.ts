import '../config/loadEnv.js';
import { createClient } from 'redis';
import {
  coalesceIngestBatch,
  shouldFlushIngestBuffer,
  WORKER_INGEST_FLUSH_INTERVAL_MS,
  WORKER_INGEST_MAX_BATCH_SIZE,
  type PendingIngestMessage,
} from './coalesceIngestBatch.js';
import { ensureConvexClient, isConvexConfigured } from './convexClient.js';
import { scheduleHudRefreshAfterBattleFinished, scheduleHudRefreshAfterLap } from './hud/hudRefreshScheduler.js';
import { fetchWorkerSyncVersion } from './hud/hudConvex.js';
import {
  updateManagedServersFromSnapshot,
  type ManagedServerRow,
} from './hud/hudManagedServers.js';
import {
  noteHudPlayerJoin,
  noteHudPlayerLeave,
  noteHudServerStatus,
} from './hud/hudPlayerPresence.js';
import { noteServerStatus } from './serverPool.js';

const REDIS_HOST = process.env.REDIS_HOST || '';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB || 0);
const REDIS_SSL = (process.env.REDIS_SSL || 'false').trim().toLowerCase() === 'true';
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'ac:events';
const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

// All VPS in the fleet should share the same group so Redis load-balances
// events across them (each event processed exactly once, no SPOF). The
// consumer name MUST be unique per VPS, so default it to AC_INSTANCE_ID.
const GROUP = process.env.REDIS_CONSUMER_GROUP || 'ac-data-consumers';
const CONSUMER =
  process.env.REDIS_CONSUMER_NAME || `ac-data-${AC_INSTANCE_ID}`;

const CONVEX_MUTATION_BATCH =
  process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
const CONVEX_INGEST_SECRET = process.env.CONVEX_INGEST_SECRET || '';
const CONVEX_WORKER_SECRET = process.env.CONVEX_WORKER_SECRET || '';
const CONVEX_CONFIG_SNAPSHOT_QUERY =
  process.env.CONVEX_CONFIG_SNAPSHOT_QUERY || 'timeAttackServers:getWorkerInstanceServerConfigs';
const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
const REDIS_CONFIG_SYNC_ENABLED =
  (process.env.REDIS_CONFIG_SYNC_ENABLED || 'true').trim().toLowerCase() === 'true';
const REDIS_CONFIG_SYNC_INTERVAL_MS = Number(process.env.REDIS_CONFIG_SYNC_INTERVAL_MS || 30_000);
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

type WorkerConfigSnapshotResult = {
  instanceId: string;
  includeInactive: boolean;
  totalServers: number;
  maxUpdatedAt: number;
  version: string;
  servers: unknown[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONFIG_ONLY_EVENTS = new Set<string>([
  'server_config_snapshot',
  'server_config_applied',
]);

type IngestEventResult = {
  ok?: boolean;
  error?: string;
  eventType?: string;
  index?: number;
};

type IngestBatchResult = {
  ok?: boolean;
  failed?: number;
  processed?: number;
  results?: IngestEventResult[];
};

function parseIngestBatchResult(raw: unknown): IngestBatchResult {
  if (!raw || typeof raw !== 'object') return {};
  return raw as IngestBatchResult;
}

/** True when every event in the batch succeeded (or the batch is empty). */
export function ingestBatchSucceeded(result: IngestBatchResult): boolean {
  const results = result.results ?? [];
  if (results.length === 0) {
    return result.ok !== false && (result.failed ?? 0) === 0;
  }
  return results.every((r) => r.ok === true);
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

function buildIngestEvent(payload: Record<string, unknown>) {
  const event = String(payload.event || '');
  const data = payload.data as Record<string, unknown> | undefined;
  return {
    eventType: event,
    serverName: typeof payload.serverName === 'string' ? payload.serverName : undefined,
    data: {
      ...(data ?? {}),
      _meta: {
        eventId: payload.eventId,
        schemaVersion: payload.schemaVersion,
        event,
        instanceId: payload.instanceId,
        serverName: payload.serverName,
        ts: payload.ts,
      },
    },
  };
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

async function publishConfigSnapshotToRedis(
  client: ReturnType<typeof createClient>,
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  const now = Date.now();
  const payload = {
    eventId: `cfg-${snapshot.instanceId}-${snapshot.version}-${now}`,
    schemaVersion: '1',
    event: 'server_config_snapshot',
    serverName: '__config__',
    instanceId: snapshot.instanceId,
    ts: now,
    data: {
      instanceId: snapshot.instanceId,
      version: snapshot.version,
      includeInactive: snapshot.includeInactive,
      totalServers: snapshot.totalServers,
      maxUpdatedAt: snapshot.maxUpdatedAt,
      servers: snapshot.servers,
    },
  };
  await client.xAdd(
    REDIS_CONFIG_STREAM_KEY,
    '*',
    {
      event: payload.event,
      eventId: payload.eventId,
      schemaVersion: payload.schemaVersion,
      instanceId: payload.instanceId,
      serverName: payload.serverName,
      ts: String(payload.ts),
      payload: JSON.stringify(payload),
    },
    {
      TRIM: {
        strategy: 'MAXLEN',
        strategyModifier: '~',
        threshold: 200000,
      },
    },
  );
}

async function startConvexConfigPublisher(client: ReturnType<typeof createClient>): Promise<void> {
  if (!REDIS_CONFIG_SYNC_ENABLED) {
    console.log('[redis-config-sync] disabled');
    return;
  }
  if (!isConvexConfigured() || !CONVEX_WORKER_SECRET) {
    console.log('[redis-config-sync] missing convex env, disabled');
    return;
  }

  const { query } = ensureConvexClient();
  let lastConfigVersion = '';

  let pollIntervalMs = REDIS_CONFIG_SYNC_INTERVAL_MS;
  try {
    const sync = await fetchWorkerSyncVersion();
    pollIntervalMs = sync.pollIntervalMs > 0 ? sync.pollIntervalMs : REDIS_CONFIG_SYNC_INTERVAL_MS;
    if (sync.pollJitterMs > 0) {
      await sleep(sync.pollJitterMs);
    }
  } catch (err) {
    console.warn('[redis-config-sync] worker sync bootstrap failed, using defaults:', err);
  }

  const loop = async () => {
    try {
      const sync = await fetchWorkerSyncVersion();
      const configVersion = sync.configVersion;
      if (!configVersion || configVersion === lastConfigVersion) {
        return;
      }

      const snapshotResult = await query(CONVEX_CONFIG_SNAPSHOT_QUERY, {
        workerSecret: CONVEX_WORKER_SECRET,
        instanceId: AC_INSTANCE_ID,
        includeInactive: true,
      });

  const snapshot = snapshotResult as WorkerConfigSnapshotResult;
  updateManagedServersFromSnapshot((snapshot.servers ?? []) as ManagedServerRow[]);
  await publishConfigSnapshotToRedis(client, snapshot);
      lastConfigVersion = configVersion;
      console.log(
        `[redis-config-sync] published snapshot configVersion=${configVersion} snapshotVersion=${snapshot.version} servers=${snapshot.totalServers}`,
      );
    } catch (err) {
      console.error('[redis-config-sync] loop error:', err);
    }
  };

  console.log(
    `[redis-config-sync] enabled instance=${AC_INSTANCE_ID} interval=${pollIntervalMs}ms stream=${REDIS_CONFIG_STREAM_KEY} syncQuery=${CONVEX_WORKER_SYNC_QUERY}`,
  );
  await loop();
  setInterval(() => {
    void loop();
  }, pollIntervalMs);
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

async function flushIngestChunk(
  client: ReturnType<typeof createClient>,
  chunk: PendingIngestMessage[],
): Promise<boolean> {
  const coalesced = coalesceIngestBatch(chunk);
  const droppedStatus = chunk.length - coalesced.length;

  for (const { payload, event } of coalesced) {
    if (event === 'server_status') {
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const players = Array.isArray(data.players) ? data.players : [];
      const statusName = typeof payload.serverName === 'string' ? payload.serverName : '';
      noteServerStatus(statusName, players.length);
      await noteHudServerStatus(payload);
    }
  }

  const ingestResult = await forwardBatchToConvex(coalesced.map((p) => p.payload));
  if (!ingestBatchSucceeded(ingestResult)) {
    const failed = ingestResult.results?.find((r) => r.ok !== true);
    console.error(
      '[redis-bridge] convex batch ingest failed (no ack):',
      coalesced.length,
      'events',
      droppedStatus > 0 ? `(coalesced ${droppedStatus} duplicate server_status)` : '',
      failed?.error ?? ingestResult,
    );
    return false;
  }

  if (droppedStatus > 0) {
    console.log(
      `[redis-bridge] ingested ${coalesced.length} events (coalesced ${droppedStatus} server_status)`,
    );
  }

  for (const { msg, payload, event } of chunk) {
    if (event === 'player_join') {
      await noteHudPlayerJoin(payload);
    } else if (event === 'player_leave') {
      await noteHudPlayerLeave(payload);
    }
    if (event === 'lap_completed') {
      scheduleHudRefreshAfterLap(payload);
    } else if (event === 'battle_finished') {
      scheduleHudRefreshAfterBattleFinished(payload);
    }
    await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
  }
  return true;
}

async function flushIngestBuffer(
  client: ReturnType<typeof createClient>,
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
    const ok = await flushIngestChunk(client, chunk);
    if (!ok) {
      state.items.unshift(...chunk);
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

async function runEventsConsumerLoop(client: ReturnType<typeof createClient>): Promise<void> {
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

  while (true) {
    try {
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
          appendToIngestBuffer(buffer, pending);
        }
      }

      try {
        await flushIngestBuffer(client, buffer);
      } catch (err) {
        console.error('[redis-bridge] flush error:', err);
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
  if (!REDIS_HOST) {
    console.log('[redis-bridge] REDIS_HOST missing, bridge disabled');
    return;
  }

  const socket = REDIS_SSL
    ? { host: REDIS_HOST, port: REDIS_PORT, tls: true as const }
    : { host: REDIS_HOST, port: REDIS_PORT };

  const client = createClient({
    socket,
    ...(REDIS_USERNAME ? { username: REDIS_USERNAME } : {}),
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    database: REDIS_DB,
  });

  client.on('error', (err) => console.error('[redis-bridge] redis error:', err));
  await client.connect();

  if (REDIS_CONFIG_SYNC_ENABLED) {
    await startConvexConfigPublisher(client);
  } else {
    console.log('[redis-config-sync] disabled (REDIS_CONFIG_SYNC_ENABLED=false)');
  }

  if (REDIS_EVENTS_BRIDGE_ENABLED) {
    void runEventsConsumerLoop(client);
  } else {
    console.log('[redis-bridge] events->Convex forwarding disabled (REDIS_EVENTS_BRIDGE_ENABLED=false)');
  }
}
