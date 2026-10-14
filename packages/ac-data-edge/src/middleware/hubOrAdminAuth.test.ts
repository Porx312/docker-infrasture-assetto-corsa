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
  process.env.FLEET_EDGE_SECRET = 'test-secret';
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
  process.env.FLEET_EDGE_SECRET = 'test-secret';
  const req = { headers: {}, cookies: {}, body: {} } as unknown as Request;
  const out = mockRes();
  let nextCalled = false;
  hubOrAdminAuth(req, out.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(out.statusCode, 403);
});

test('hubOrAdminAuth rejects empty configured secrets', () => {
  process.env.CONVEX_WORKER_SECRET = '   ';
  process.env.FLEET_EDGE_SECRET = '';
  const req = {
    headers: { 'x-worker-secret': 'anything' },
    body: {},
  } as unknown as Request;
  const out = mockRes();
  let nextCalled = false;
  hubOrAdminAuth(req, out.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(out.statusCode, 403);
});

test('hubOrAdminAuth with FLEET set rejects CONVEX-only header', () => {
  process.env.FLEET_EDGE_SECRET = 'fleet-only-secret-value-32chars!!!!';
  process.env.CONVEX_WORKER_SECRET = 'convex-other-secret-value-32chars!!';
  const req = {
    headers: { 'x-worker-secret': 'convex-other-secret-value-32chars!!' },
    body: {},
  } as unknown as Request;
  const out = mockRes();
  let nextCalled = false;
  hubOrAdminAuth(req, out.res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(out.statusCode, 403);
});
