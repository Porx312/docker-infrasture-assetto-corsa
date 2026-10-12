import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

import { clientSyncApiKeyMiddleware } from './clientSyncAuth.js';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

test('clientSyncApiKeyMiddleware returns 500 when CLIENT_SYNC_API_KEY missing', () => {
  const prev = process.env.CLIENT_SYNC_API_KEY;
  delete process.env.CLIENT_SYNC_API_KEY;
  try {
    const res = mockRes();
    let nextCalled = false;
    clientSyncApiKeyMiddleware(
      { headers: {}, query: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(res.statusCode, 500);
    assert.equal(nextCalled, false);
  } finally {
    if (prev === undefined) delete process.env.CLIENT_SYNC_API_KEY;
    else process.env.CLIENT_SYNC_API_KEY = prev;
  }
});

test('clientSyncApiKeyMiddleware returns 401 for wrong x-api-key', () => {
  const prev = process.env.CLIENT_SYNC_API_KEY;
  process.env.CLIENT_SYNC_API_KEY = 'correct-key';
  try {
    const res = mockRes();
    let nextCalled = false;
    clientSyncApiKeyMiddleware(
      { headers: { 'x-api-key': 'wrong' }, query: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  } finally {
    if (prev === undefined) delete process.env.CLIENT_SYNC_API_KEY;
    else process.env.CLIENT_SYNC_API_KEY = prev;
  }
});

test('clientSyncApiKeyMiddleware accepts matching x-api-key', () => {
  const prev = process.env.CLIENT_SYNC_API_KEY;
  process.env.CLIENT_SYNC_API_KEY = 'correct-key';
  try {
    const res = mockRes();
    let nextCalled = false;
    clientSyncApiKeyMiddleware(
      { headers: { 'x-api-key': 'correct-key' }, query: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(nextCalled, true);
  } finally {
    if (prev === undefined) delete process.env.CLIENT_SYNC_API_KEY;
    else process.env.CLIENT_SYNC_API_KEY = prev;
  }
});
