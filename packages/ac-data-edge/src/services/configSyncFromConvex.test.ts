import assert from 'node:assert/strict';
import test from 'node:test';

import type { RedisClientType } from 'redis';

import {
  bindConfigSyncRedisClient,
  getLastConfigVersionForTests,
  refreshConfigFromConvex,
  resetConfigSyncStateForTests,
  setConfigSyncTestHooks,
  type WorkerConfigSnapshotResult,
} from './configSyncFromConvex.js';

const snapshot: WorkerConfigSnapshotResult = {
  instanceId: 'default',
  includeInactive: true,
  totalServers: 2,
  maxUpdatedAt: 1_700_000_000_000,
  version: 'snap-v2',
  servers: [{ serverName: 'server', displayName: 'ProjectD', type: 'unified' }],
};

function bindFakeRedisClient(): void {
  bindConfigSyncRedisClient({
    xAdd: async () => '1-0',
  } as unknown as RedisClientType);
}

test.beforeEach(() => {
  resetConfigSyncStateForTests();
  bindFakeRedisClient();
  process.env.CONVEX_DEPLOYMENT_URL = 'https://example.convex.cloud';
  process.env.CONVEX_WORKER_SECRET = 'test-worker-secret';
  setConfigSyncTestHooks({
    fetchWorkerSyncVersion: async () => ({
      configVersion: 'cfg-v2',
      pollIntervalMs: 600_000,
      pollJitterMs: 0,
    }),
    fetchSnapshot: async () => snapshot,
    publishSnapshot: async () => {},
  });
});

test.afterEach(() => {
  setConfigSyncTestHooks(null);
});

test('refreshConfigFromConvex publishes when config version changes', async () => {
  let published = 0;
  setConfigSyncTestHooks({
    fetchWorkerSyncVersion: async () => ({
      configVersion: 'cfg-v2',
      pollIntervalMs: 600_000,
      pollJitterMs: 0,
    }),
    fetchSnapshot: async () => snapshot,
    publishSnapshot: async () => {
      published += 1;
    },
  });

  const result = await refreshConfigFromConvex({ reason: 'webhook', expectedConfigVersion: 'cfg-v2' });

  assert.equal(result.published, true);
  assert.equal(result.configVersion, 'cfg-v2');
  assert.equal(published, 1);
  assert.equal(getLastConfigVersionForTests(), 'cfg-v2');
});

test('refreshConfigFromConvex skips when expected version matches last published', async () => {
  let published = 0;
  setConfigSyncTestHooks({
    fetchWorkerSyncVersion: async () => ({
      configVersion: 'cfg-v2',
      pollIntervalMs: 600_000,
      pollJitterMs: 0,
    }),
    fetchSnapshot: async () => snapshot,
    publishSnapshot: async () => {
      published += 1;
    },
  });

  await refreshConfigFromConvex({ reason: 'webhook', expectedConfigVersion: 'cfg-v2' });
  const second = await refreshConfigFromConvex({ reason: 'webhook', expectedConfigVersion: 'cfg-v2' });

  assert.equal(second.published, false);
  assert.equal(published, 1);
});

test('refreshConfigFromConvex force bypasses version dedupe', async () => {
  let published = 0;
  setConfigSyncTestHooks({
    fetchWorkerSyncVersion: async () => ({
      configVersion: 'cfg-v2',
      pollIntervalMs: 600_000,
      pollJitterMs: 0,
    }),
    fetchSnapshot: async () => snapshot,
    publishSnapshot: async () => {
      published += 1;
    },
  });

  await refreshConfigFromConvex({ reason: 'webhook', expectedConfigVersion: 'cfg-v2' });
  const forced = await refreshConfigFromConvex({
    reason: 'webhook',
    expectedConfigVersion: 'cfg-v2',
    force: true,
  });

  assert.equal(forced.published, true);
  assert.equal(published, 2);
});
