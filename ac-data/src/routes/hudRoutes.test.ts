import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import hudRoutes from './hudRoutes.js';
import {
  bindConfigSyncRedisClient,
  resetConfigSyncStateForTests,
  setConfigSyncTestHooks,
} from '../services/configSyncFromConvex.js';
import { setFetchPlayerJoinContextForTests } from '../services/hud/playerJoinContext.js';

const originalSecret = process.env.CONVEX_WORKER_SECRET;
const originalInstanceId = process.env.AC_INSTANCE_ID;
const originalConvexUrl = process.env.CONVEX_DEPLOYMENT_URL;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/hud', hudRoutes);
  return app;
}

async function postRefreshConfig(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = createTestApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/hud/worker/refresh-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function postRefreshUser(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = createTestApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/hud/worker/refresh-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function getConvexQueryStats(
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = createTestApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/hud/worker/convex-query-stats`, {
      headers,
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test.before(() => {
  process.env.CONVEX_WORKER_SECRET = 'test-worker-secret';
  process.env.AC_INSTANCE_ID = 'default';
  process.env.CONVEX_DEPLOYMENT_URL = 'https://example.convex.cloud';
  bindConfigSyncRedisClient({ xAdd: async () => '1-0' } as never);
  setConfigSyncTestHooks({
    fetchWorkerSyncVersion: async () => ({
      configVersion: 'cfg-v2',
      pollIntervalMs: 600_000,
      pollJitterMs: 0,
    }),
    fetchSnapshot: async () => ({
      instanceId: 'default',
      includeInactive: true,
      totalServers: 1,
      maxUpdatedAt: 1,
      version: 'snap-v2',
      servers: [],
    }),
    publishSnapshot: async () => {},
  });
});

test.after(() => {
  process.env.CONVEX_WORKER_SECRET = originalSecret;
  process.env.AC_INSTANCE_ID = originalInstanceId;
  process.env.CONVEX_DEPLOYMENT_URL = originalConvexUrl;
  setFetchPlayerJoinContextForTests(null);
  setConfigSyncTestHooks(null);
  resetConfigSyncStateForTests();
});

test('POST /hud/worker/refresh-user rejects unauthorized requests', async () => {
  const { status, json } = await postRefreshUser({
    steamId: '76561199000000001',
    workerSecret: 'wrong',
  });

  assert.equal(status, 401);
  assert.equal(json.ok, false);
});

test('POST /hud/worker/refresh-user requires steamId', async () => {
  const { status, json } = await postRefreshUser({
    workerSecret: 'test-worker-secret',
  });

  assert.equal(status, 400);
  assert.equal(json.ok, false);
});

test('POST /hud/worker/refresh-user returns 503 when Convex refresh fails', async () => {
  setFetchPlayerJoinContextForTests(async () => {
    throw new Error('convex down');
  });

  const { status, json } = await postRefreshUser({
    steamId: '76561199000000001',
    workerSecret: 'test-worker-secret',
  });

  assert.equal(status, 503);
  assert.equal(json.ok, false);
  assert.equal(json.convexRefreshFailed, true);
  assert.match(String(json.error), /convex down/);
});

test('POST /hud/worker/refresh-user returns ok on success', async () => {
  setFetchPlayerJoinContextForTests(async () => ({
    ok: true,
    user: { steamId: '76561199000000001', isInvalidated: false },
  }));

  const { status, json } = await postRefreshUser({
    steamId: '76561199000000001',
    workerSecret: 'test-worker-secret',
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.steamId, '76561199000000001');
});

test('GET /hud/worker/convex-query-stats requires worker auth', async () => {
  const { status, json } = await getConvexQueryStats();

  assert.equal(status, 401);
  assert.equal(json.ok, false);
});

test('GET /hud/worker/convex-query-stats returns counters when authorized', async () => {
  const { status, json } = await getConvexQueryStats({
    'x-worker-secret': 'test-worker-secret',
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(typeof json.total, 'number');
  assert.equal(typeof json.queries, 'object');
});

test('POST /hud/worker/refresh-config rejects unauthorized requests', async () => {
  const { status, json } = await postRefreshConfig({
    instanceId: 'default',
    workerSecret: 'wrong',
  });

  assert.equal(status, 401);
  assert.equal(json.ok, false);
});

test('POST /hud/worker/refresh-config requires instanceId', async () => {
  const { status, json } = await postRefreshConfig({
    workerSecret: 'test-worker-secret',
  });

  assert.equal(status, 400);
  assert.equal(json.ok, false);
});

test('POST /hud/worker/refresh-config rejects instance mismatch', async () => {
  const { status, json } = await postRefreshConfig({
    workerSecret: 'test-worker-secret',
    instanceId: 'other-vps',
  });

  assert.equal(status, 404);
  assert.equal(json.error, 'instance_mismatch');
});

test('POST /hud/worker/refresh-config returns ok on success', async () => {
  resetConfigSyncStateForTests();

  const { status, json } = await postRefreshConfig({
    workerSecret: 'test-worker-secret',
    instanceId: 'default',
    configVersion: 'cfg-v2',
    reason: 'server_updated',
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.published, true);
  assert.equal(json.configVersion, 'cfg-v2');
});

test('POST /hud/worker/refresh-config skips when configVersion unchanged', async () => {
  resetConfigSyncStateForTests();
  await postRefreshConfig({
    workerSecret: 'test-worker-secret',
    instanceId: 'default',
    configVersion: 'cfg-v2',
  });

  const { status, json } = await postRefreshConfig({
    workerSecret: 'test-worker-secret',
    instanceId: 'default',
    configVersion: 'cfg-v2',
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.published, false);
});
