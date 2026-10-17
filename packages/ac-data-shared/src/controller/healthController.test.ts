import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicHealthHandler,
  getPublicLiveHandler,
} from './healthController.js';
import type { AcDataHealth } from '../services/healthService.js';

function mockRes() {
  let statusCode = 0;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  };
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

function unhealthyRedis(): AcDataHealth {
  return {
    ok: false,
    version: 'test',
    builtAt: null,
    uptimeSec: 1,
    instanceId: 'test',
    redis: {
      configured: true,
      ok: false,
      streamLength: null,
      pendingEvents: null,
      message: 'Redis down',
    },
    convex: {
      configured: false,
      ingestSecretSet: false,
      workerSecretSet: false,
    },
  };
}

test('/api/live returns 200 even when Redis would be down', () => {
  const m = mockRes();
  getPublicLiveHandler({} as never, m.res as never);
  assert.equal(m.status, 200);
  assert.deepEqual(m.body, { ok: true });
});

test('/api/health returns 503 when getAcDataHealth reports Redis down', async () => {
  const m = mockRes();
  const handler = createPublicHealthHandler({
    getHealth: async () => unhealthyRedis(),
  });
  await handler({} as never, m.res as never);
  assert.equal(m.status, 503);
  assert.deepEqual(m.body, { ok: false });
});

test('/api/health returns 200 when healthy', async () => {
  const m = mockRes();
  const healthy = unhealthyRedis();
  healthy.ok = true;
  healthy.redis.ok = true;
  const handler = createPublicHealthHandler({
    getHealth: async () => healthy,
  });
  await handler({} as never, m.res as never);
  assert.equal(m.status, 200);
  assert.deepEqual(m.body, { ok: true });
});

test('/api/health returns 503 when getHealth throws', async () => {
  const m = mockRes();
  const handler = createPublicHealthHandler({
    getHealth: async () => {
      throw new Error('redis unavailable');
    },
  });
  await handler({} as never, m.res as never);
  assert.equal(m.status, 503);
  assert.deepEqual(m.body, { ok: false });
});
