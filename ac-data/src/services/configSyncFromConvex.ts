import '../config/loadEnv.js';
import type { RedisClientType } from 'redis';

import { ensureConvexClient, isConvexConfigured } from './convexClient.js';
import { fetchWorkerSyncVersion } from './hud/hudConvex.js';
import {
  updateManagedServersFromSnapshot,
  type ManagedServerRow,
} from './hud/hudManagedServers.js';

const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';
const CONVEX_CONFIG_SNAPSHOT_QUERY =
  process.env.CONVEX_CONFIG_SNAPSHOT_QUERY || 'timeAttackServers:getWorkerInstanceServerConfigs';
const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
export const REDIS_CONFIG_SYNC_INTERVAL_MS = Number(
  process.env.REDIS_CONFIG_SYNC_INTERVAL_MS || 600_000,
);
export const REDIS_CONFIG_SYNC_FALLBACK_ENABLED =
  (process.env.REDIS_CONFIG_SYNC_FALLBACK_ENABLED || 'true').trim().toLowerCase() === 'true';

export type WorkerConfigSnapshotResult = {
  instanceId: string;
  includeInactive: boolean;
  totalServers: number;
  maxUpdatedAt: number;
  version: string;
  servers: unknown[];
};

export type RefreshConfigFromConvexOptions = {
  expectedConfigVersion?: string;
  reason?: string;
  force?: boolean;
};

export type RefreshConfigFromConvexResult = {
  published: boolean;
  configVersion: string;
  snapshotVersion?: string;
  totalServers?: number;
};

type ConfigSyncTestHooks = {
  fetchWorkerSyncVersion?: typeof fetchWorkerSyncVersion;
  fetchSnapshot?: () => Promise<WorkerConfigSnapshotResult>;
  publishSnapshot?: (snapshot: WorkerConfigSnapshotResult) => Promise<void>;
};

let lastConfigVersion = '';
let configSyncClient: RedisClientType | null = null;
let testHooks: ConfigSyncTestHooks | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readWorkerSyncVersion() {
  if (testHooks?.fetchWorkerSyncVersion) {
    return testHooks.fetchWorkerSyncVersion();
  }
  return fetchWorkerSyncVersion();
}

async function fetchConfigSnapshot(): Promise<WorkerConfigSnapshotResult> {
  if (testHooks?.fetchSnapshot) {
    return testHooks.fetchSnapshot();
  }
  if (!isConvexConfigured() || !CONVEX_WORKER_SECRET) {
    throw new Error('Convex worker env missing for config snapshot');
  }
  const { query } = ensureConvexClient();
  const snapshotResult = await query(CONVEX_CONFIG_SNAPSHOT_QUERY, {
    workerSecret: CONVEX_WORKER_SECRET,
    instanceId: AC_INSTANCE_ID,
    includeInactive: true,
  });
  return snapshotResult as WorkerConfigSnapshotResult;
}

async function publishConfigSnapshotToRedis(
  client: RedisClientType,
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  if (testHooks?.publishSnapshot) {
    await testHooks.publishSnapshot(snapshot);
    return;
  }
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

/** Test hook: inject Convex/Redis dependencies. */
export function setConfigSyncTestHooks(hooks: ConfigSyncTestHooks | null): void {
  testHooks = hooks;
}

/** Test helper: reset in-memory config version dedupe state. */
export function resetConfigSyncStateForTests(): void {
  lastConfigVersion = '';
}

export function getLastConfigVersionForTests(): string {
  return lastConfigVersion;
}

/** Fetch Convex server configs and publish to Redis when version changed. */
export async function refreshConfigFromConvex(
  options?: RefreshConfigFromConvexOptions,
): Promise<RefreshConfigFromConvexResult> {
  if (!isConvexConfigured() || !CONVEX_WORKER_SECRET) {
    throw new Error('Convex worker env missing');
  }
  if (!configSyncClient) {
    throw new Error('Config sync Redis client not initialized');
  }

  const reason = options?.reason?.trim() || 'poll';
  const force = options?.force === true;
  const expected = options?.expectedConfigVersion?.trim() || '';

  if (!force && expected && expected === lastConfigVersion) {
    return { published: false, configVersion: lastConfigVersion };
  }

  let configVersion = expected;
  if (!force && !configVersion) {
    const sync = await readWorkerSyncVersion();
    configVersion = sync.configVersion.trim();
    if (!configVersion || configVersion === lastConfigVersion) {
      return { published: false, configVersion: configVersion || lastConfigVersion };
    }
  } else if (!force && configVersion && configVersion === lastConfigVersion) {
    return { published: false, configVersion: lastConfigVersion };
  }

  const snapshot = await fetchConfigSnapshot();
  updateManagedServersFromSnapshot((snapshot.servers ?? []) as ManagedServerRow[]);
  await publishConfigSnapshotToRedis(configSyncClient, snapshot);

  if (!configVersion) {
    const sync = await readWorkerSyncVersion();
    configVersion = sync.configVersion.trim() || snapshot.version;
  }
  lastConfigVersion = configVersion;

  console.log(
    `[redis-config-sync] published reason=${reason} configVersion=${configVersion} snapshotVersion=${snapshot.version} servers=${snapshot.totalServers}`,
  );

  return {
    published: true,
    configVersion,
    snapshotVersion: snapshot.version,
    totalServers: snapshot.totalServers,
  };
}

/** Bind Redis client used for config snapshot publish (webhook + fallback poll). */
export function bindConfigSyncRedisClient(client: RedisClientType): void {
  configSyncClient = client;
}

/** Slow fallback poll + bootstrap; webhook calls refreshConfigFromConvex directly. */
export async function startConvexConfigPublisher(client: RedisClientType): Promise<void> {
  bindConfigSyncRedisClient(client);

  if (!isConvexConfigured() || !CONVEX_WORKER_SECRET) {
    console.log('[redis-config-sync] missing convex env, publisher disabled');
    return;
  }

  let pollIntervalMs = REDIS_CONFIG_SYNC_INTERVAL_MS;
  try {
    const sync = await readWorkerSyncVersion();
    pollIntervalMs = sync.pollIntervalMs > 0 ? sync.pollIntervalMs : REDIS_CONFIG_SYNC_INTERVAL_MS;
    if (sync.pollJitterMs > 0) {
      await sleep(sync.pollJitterMs);
    }
  } catch (err) {
    console.warn('[redis-config-sync] worker sync bootstrap failed, using defaults:', err);
  }

  console.log(
    `[redis-config-sync] enabled instance=${AC_INSTANCE_ID} fallback=${REDIS_CONFIG_SYNC_FALLBACK_ENABLED} interval=${pollIntervalMs}ms stream=${REDIS_CONFIG_STREAM_KEY} syncQuery=${CONVEX_WORKER_SYNC_QUERY}`,
  );

  try {
    await refreshConfigFromConvex({ reason: 'bootstrap' });
  } catch (err) {
    console.error('[redis-config-sync] bootstrap refresh error:', err);
  }

  if (!REDIS_CONFIG_SYNC_FALLBACK_ENABLED) {
    console.log('[redis-config-sync] fallback poll disabled (webhook-only mode)');
    return;
  }

  setInterval(() => {
    void refreshConfigFromConvex({ reason: 'fallback_poll' }).catch((err) => {
      console.error('[redis-config-sync] fallback poll error:', err);
    });
  }, pollIntervalMs);
}
