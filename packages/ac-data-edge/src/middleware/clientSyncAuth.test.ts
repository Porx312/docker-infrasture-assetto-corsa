import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import { clientSyncApiKeyMiddleware } from './clientSyncAuth.js';

function mockReqRes(apiKey?: string, headerKey?: string) {
  const req = {
    headers: headerKey ? { 'x-api-key': headerKey } : {},
    query: apiKey ? { api_key: apiKey } : {},
  } as unknown as Request;

  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  return { req, res, getStatus: () => statusCode, getBody: () => body };
}

test('clientSyncApiKeyMiddleware blocks when env missing', () => {
  const prev = process.env.CLIENT_SYNC_API_KEY;
  delete process.env.CLIENT_SYNC_API_KEY;
  const { req, res, getStatus } = mockReqRes('secret');
  let called = false;
  clientSyncApiKeyMiddleware(req, res, () => {
    called = true;
  });
  assert.equal(getStatus(), 500);
  assert.equal(called, false);
  if (prev) process.env.CLIENT_SYNC_API_KEY = prev;
});

test('clientSyncApiKeyMiddleware accepts matching x-api-key', () => {
  process.env.CLIENT_SYNC_API_KEY = 'desktop-test-key';
  const { req, res, getStatus } = mockReqRes(undefined, 'desktop-test-key');
  let called = false;
  clientSyncApiKeyMiddleware(req, res, () => {
    called = true;
  });
  assert.equal(getStatus(), 200);
  assert.equal(called, true);
});

test('clientSyncApiKeyMiddleware rejects invalid key', () => {
  process.env.CLIENT_SYNC_API_KEY = 'desktop-test-key';
  const { req, res, getStatus } = mockReqRes(undefined, 'wrong');
  let called = false;
  clientSyncApiKeyMiddleware(req, res, () => {
    called = true;
  });
  assert.equal(getStatus(), 401);
  assert.equal(called, false);
});
