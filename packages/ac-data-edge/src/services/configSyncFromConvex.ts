import '@projectd/ac-data-shared/config/loadEnv.js';
import type { RedisClientType } from 'redis';

import { isConvexConfigured } from '@projectd/ac-data-shared/services/convexClient.js';
import { publishConfigSnapshotToRedis } from '@projectd/ac-data-shared/services/config/configSnapshotRedis.js';
import {
  queryWorkerConfigSnapshot,
  type WorkerConfigSnapshotResult,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { isEdgeConfigSyncEnabled } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { fetchWorkerSyncVersion } from './hud/hudConvex.js';
import {
  updateManagedServersFromSnapshot,
  type ManagedServerRow,
} from './hud/hudManagedServers.js';
import { publishHudRegistryToHubIfConfigured } from './hud/edgeHudRegistryPublish.js';

const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';
const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
export const REDIS_CONFIG_SYNC_INTERVAL_MS = Number(
  process.env.REDIS_CONFIG_SYNC_INTERVAL_MS || 600_000,
);
export const REDIS_CONFIG_SYNC_FALLBACK_ENABLED =
  (process.env.REDIS_CONFIG_SYNC_FALLBACK_ENABLED || 'true').trim().toLowerCase() === 'true';

export type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';

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
  return queryWorkerConfigSnapshot(AC_INSTANCE_ID);
}

async function publishSnapshot(
  client: RedisClientType,
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  if (testHooks?.publishSnapshot) {
    await testHooks.publishSnapshot(snapshot);
    return;
  }
  await publishConfigSnapshotToRedis(client, snapshot);
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
  await publishSnapshot(configSyncClient, snapshot);
  void publishHudRegistryToHubIfConfigured().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-registry-sync] after config publish failed: ${message}`);
  });

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
/** Publish hub-fetched snapshot to local Redis (no Convex on edge). */
export async function publishConfigSnapshotFromHub(
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  if (!configSyncClient) {
    throw new Error('Config sync Redis client not initialized');
  }
  if (snapshot.instanceId !== AC_INSTANCE_ID) {
    throw new Error(`instance_mismatch expected=${AC_INSTANCE_ID} got=${snapshot.instanceId}`);
  }
  updateManagedServersFromSnapshot((snapshot.servers ?? []) as ManagedServerRow[]);
  await publishSnapshot(configSyncClient, snapshot);
  lastConfigVersion = snapshot.version;
  console.log(
    `[redis-config-sync] hub push instance=${snapshot.instanceId} version=${snapshot.version} servers=${snapshot.totalServers}`,
  );
  void publishHudRegistryToHubIfConfigured().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-registry-sync] after hub push failed: ${message}`);
  });
}

export async function startConvexConfigPublisher(client: RedisClientType): Promise<void> {
  bindConfigSyncRedisClient(client);

  if (!isEdgeConfigSyncEnabled()) {
    console.log('[redis-config-sync] disabled on edge (hub-centric config; REDIS_CONFIG_SYNC_ON_EDGE=false)');
    return;
  }

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
