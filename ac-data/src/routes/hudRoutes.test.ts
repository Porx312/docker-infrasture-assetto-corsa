import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import hudRoutes from './hudRoutes.js';
import { setFetchPlayerJoinContextForTests } from '../services/hud/playerJoinContext.js';

const originalSecret = process.env.CONVEX_WORKER_SECRET;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/hud', hudRoutes);
  return app;
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
});

test.after(() => {
  process.env.CONVEX_WORKER_SECRET = originalSecret;
  setFetchPlayerJoinContextForTests(null);
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
