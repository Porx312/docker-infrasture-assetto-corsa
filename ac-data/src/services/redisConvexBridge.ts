import dotenv from 'dotenv';
import { createClient } from 'redis';
import { ConvexHttpClient } from 'convex/browser';

dotenv.config();

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

const CONVEX_DEPLOYMENT_URL = process.env.CONVEX_DEPLOYMENT_URL || '';
const CONVEX_PRODUCT_KEY = process.env.CONVEX_PRODUCT_KEY || '';

const CONVEX_MUTATION_BATCH =
  process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
const CONVEX_INGEST_SECRET = process.env.CONVEX_INGEST_SECRET || '';
const CONVEX_WORKER_SECRET = process.env.CONVEX_WORKER_SECRET || '';
const CONVEX_CONFIG_VERSION_QUERY =
  process.env.CONVEX_CONFIG_VERSION_QUERY || 'timeAttackServers:getWorkerInstanceConfigVersion';
const CONVEX_CONFIG_SNAPSHOT_QUERY =
  process.env.CONVEX_CONFIG_SNAPSHOT_QUERY || 'timeAttackServers:getWorkerInstanceServerConfigs';
const REDIS_CONFIG_SYNC_ENABLED =
  (process.env.REDIS_CONFIG_SYNC_ENABLED || 'true').trim().toLowerCase() === 'true';
const REDIS_CONFIG_SYNC_INTERVAL_MS = Number(process.env.REDIS_CONFIG_SYNC_INTERVAL_MS || 5000);
// Recommended: keep enabled on every VPS sharing the same REDIS_CONSUMER_GROUP.
// Redis load-balances events across consumers (no duplicates, no SPOF).
// Set to false on a node only if you want a single-primary topology.
const REDIS_EVENTS_BRIDGE_ENABLED =
  (process.env.REDIS_EVENTS_BRIDGE_ENABLED || 'true').trim().toLowerCase() === 'true';

type StreamMessage = {
  id: string;
  fields?: Record<string, string>;
  message?: Record<string, string>;
};

type StreamReadResult = Array<{
  name: string;
  messages: StreamMessage[];
}>;

type WorkerConfigVersionResult = {
  instanceId: string;
  serverCount: number;
  presetCount: number;
  maxUpdatedAt: number;
  version: string;
};

type WorkerConfigSnapshotResult = {
  instanceId: string;
  includeInactive: boolean;
  totalServers: number;
  maxUpdatedAt: number;
  version: string;
  servers: unknown[];
};

const CONFIG_ONLY_EVENTS = new Set<string>([
  'server_config_snapshot',
  'server_config_applied',
]);

function parsePayload(message: StreamMessage): Record<string, unknown> | null {
  const raw = message.fields?.payload ?? message.message?.payload;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ensureConvexClient(): {
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
} {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_PRODUCT_KEY) {
    throw new Error('CONVEX_DEPLOYMENT_URL / CONVEX_PRODUCT_KEY must be set');
  }
  const client = new ConvexHttpClient(CONVEX_DEPLOYMENT_URL);
  const anyClient = client as unknown as {
    setAdminAuth: (token: string) => void;
    mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
  anyClient.setAdminAuth(CONVEX_PRODUCT_KEY);
  return { mutation: anyClient.mutation.bind(anyClient), query: anyClient.query.bind(anyClient) };
}

async function forwardToConvex(payload: Record<string, unknown>): Promise<void> {
  if (!CONVEX_INGEST_SECRET) {
    throw new Error('CONVEX_INGEST_SECRET missing for direct mode');
  }

  const { mutation } = ensureConvexClient();
  const event = String(payload.event || '');
  const data = payload.data as Record<string, unknown> | undefined;
  const mutationArgs = {
    ingestSecret: CONVEX_INGEST_SECRET,
    events: [
      {
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
      },
    ],
  };

  await mutation(CONVEX_MUTATION_BATCH, mutationArgs);
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
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_PRODUCT_KEY || !CONVEX_WORKER_SECRET) {
    console.log('[redis-config-sync] missing convex env, disabled');
    return;
  }

  const { query } = ensureConvexClient();
  let lastVersion = '';

  const loop = async () => {
    try {
      const versionResult = await query(CONVEX_CONFIG_VERSION_QUERY, {
        workerSecret: CONVEX_WORKER_SECRET,
        instanceId: AC_INSTANCE_ID,
      });
      const version = (versionResult as WorkerConfigVersionResult).version;
      if (!version || version === lastVersion) {
        return;
      }

      const snapshotResult = await query(CONVEX_CONFIG_SNAPSHOT_QUERY, {
        workerSecret: CONVEX_WORKER_SECRET,
        instanceId: AC_INSTANCE_ID,
        includeInactive: true,
      });

      const snapshot = snapshotResult as WorkerConfigSnapshotResult;
      await publishConfigSnapshotToRedis(client, snapshot);
      // Must compare against the same `version` string in subsequent polls; the
      // snapshot uses a different formula in Convex and would re-publish forever.
      lastVersion = version;
      console.log(
        `[redis-config-sync] published snapshot configVersion=${version} snapshotVersion=${snapshot.version} servers=${snapshot.totalServers}`,
      );
    } catch (err) {
      console.error('[redis-config-sync] loop error:', err);
    }
  };

  console.log(
    `[redis-config-sync] enabled instance=${AC_INSTANCE_ID} interval=${REDIS_CONFIG_SYNC_INTERVAL_MS}ms stream=${REDIS_CONFIG_STREAM_KEY}`,
  );
  await loop();
  setInterval(() => {
    void loop();
  }, REDIS_CONFIG_SYNC_INTERVAL_MS);
}

async function runEventsConsumerLoop(client: ReturnType<typeof createClient>): Promise<void> {
  try {
    await client.xGroupCreate(REDIS_STREAM_KEY, GROUP, '0', { MKSTREAM: true });
    console.log(`[redis-bridge] consumer group created: ${GROUP}`);
  } catch {
    // group probably exists
  }

  console.log(`[redis-bridge] listening stream=${REDIS_STREAM_KEY} group=${GROUP} consumer=${CONSUMER}`);

  while (true) {
    try {
      const raw = await client.xReadGroup(
        GROUP,
        CONSUMER,
        { key: REDIS_STREAM_KEY, id: '>' },
        { COUNT: 25, BLOCK: 5000 },
      );
      const results = (raw ?? null) as unknown as StreamReadResult | null;
      if (!results || results.length === 0) continue;

      for (const stream of results) {
        const messages = stream.messages;
        for (const msg of messages) {
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
          try {
            await forwardToConvex(payload);
            await client.xAck(REDIS_STREAM_KEY, GROUP, msg.id);
          } catch (err) {
            console.error('[redis-bridge] process error:', err);
          }
        }
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
