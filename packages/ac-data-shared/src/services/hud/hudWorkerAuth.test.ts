import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isModPeerRequestAuthorized,
  isWorkerRequestAuthorized,
  readSteamIdFromWorkerRequest,
  readWorkerSecretFromRequest,
} from './hudWorkerAuth.js';

const originalSecret = process.env.CONVEX_WORKER_SECRET;
const originalFleet = process.env.FLEET_EDGE_SECRET;
const originalPeer = process.env.MOD_PEER_SECRET;

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
  process.env.FLEET_EDGE_SECRET = 'secret-abc';
  process.env.CONVEX_WORKER_SECRET = 'convex-other';
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
  if (originalFleet !== undefined) process.env.FLEET_EDGE_SECRET = originalFleet;
  else delete process.env.FLEET_EDGE_SECRET;
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

test('fleet proxy auth uses FLEET_EDGE_SECRET; peer blob uses MOD_PEER_SECRET', () => {
  process.env.CONVEX_WORKER_SECRET = 'convex';
  process.env.FLEET_EDGE_SECRET = 'fleet';
  process.env.MOD_PEER_SECRET = 'peer';
  const fleetReq = { headers: { 'x-worker-secret': 'fleet' }, body: {} } as never;
  const peerReq = { headers: { 'x-worker-secret': 'peer' }, body: {} } as never;
  assert.equal(isWorkerRequestAuthorized(fleetReq), true);
  assert.equal(isWorkerRequestAuthorized(peerReq), false);
  assert.equal(isModPeerRequestAuthorized(peerReq), true);
  assert.equal(isModPeerRequestAuthorized(fleetReq), false);
  process.env.CONVEX_WORKER_SECRET = originalSecret;
  if (originalFleet !== undefined) process.env.FLEET_EDGE_SECRET = originalFleet;
  else delete process.env.FLEET_EDGE_SECRET;
  if (originalPeer !== undefined) process.env.MOD_PEER_SECRET = originalPeer;
  else delete process.env.MOD_PEER_SECRET;
});
