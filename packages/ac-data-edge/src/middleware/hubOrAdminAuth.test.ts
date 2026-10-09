import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import type { Request, Response } from 'express';
import { hubOrAdminAuth } from './hubOrAdminAuth.js';

function mockRes() {
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

afterEach(() => {
  delete process.env.CONVEX_WORKER_SECRET;
  delete process.env.FLEET_EDGE_SECRET;
});

test('hubOrAdminAuth accepts worker secret', () => {
  process.env.CONVEX_WORKER_SECRET = 'test-secret';
  const req = {
    headers: { 'x-worker-secret': 'test-secret' },
    body: {},
  } as unknown as Request;
  const out = mockRes();
  let nextCalled = false;
  hubOrAdminAuth(req, out.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal((req as Request & { adminUser?: string }).adminUser, 'hub');
});

test('hubOrAdminAuth rejects without secret', () => {
  process.env.CONVEX_WORKER_SECRET = 'test-secret';
  const req = { headers: {}, cookies: {}, body: {} } as unknown as Request;
  const out = mockRes();
  let nextCalled = false;
  hubOrAdminAuth(req, out.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(out.statusCode, 403);
});
