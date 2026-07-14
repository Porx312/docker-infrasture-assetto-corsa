import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWorkerRequestAuthorized,
  readSteamIdFromWorkerRequest,
  readWorkerSecretFromRequest,
} from './hudWorkerAuth.js';

const originalSecret = process.env.CONVEX_WORKER_SECRET;

test('readWorkerSecretFromRequest prefers x-worker-secret header', () => {
  process.env.CONVEX_WORKER_SECRET = 'secret-abc';
  const req = {
    headers: { 'x-worker-secret': 'secret-abc' },
    body: { workerSecret: 'other' },
  } as never;

  assert.equal(readWorkerSecretFromRequest(req), 'secret-abc');
  process.env.CONVEX_WORKER_SECRET = originalSecret;
});

test('isWorkerRequestAuthorized rejects missing or wrong secret', () => {
  process.env.CONVEX_WORKER_SECRET = 'secret-abc';
  const authorized = {
    headers: {},
    body: { workerSecret: 'secret-abc', steamId: '76561199000000001' },
  } as never;
  const wrong = {
    headers: {},
    body: { workerSecret: 'wrong', steamId: '76561199000000001' },
  } as never;

  assert.equal(isWorkerRequestAuthorized(authorized), true);
  assert.equal(isWorkerRequestAuthorized(wrong), false);
  process.env.CONVEX_WORKER_SECRET = originalSecret;
});

test('readSteamIdFromWorkerRequest accepts steamId and steam_id', () => {
  assert.equal(
    readSteamIdFromWorkerRequest({ body: { steamId: ' 76561199000000001 ' } } as never),
    '76561199000000001',
  );
  assert.equal(
    readSteamIdFromWorkerRequest({ body: { steam_id: '76561199000000002' } } as never),
    '76561199000000002',
  );
});
