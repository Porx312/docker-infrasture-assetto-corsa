import assert from 'node:assert/strict';
import test from 'node:test';

import { fleetEdgeSecret, modPeerSecret, secretsMatch } from './fleetSecrets.js';

test('fleetEdgeSecret falls back only with ALLOW_INSECURE_DEFAULTS outside prod', () => {
  const prev = { ...process.env };
  delete process.env.FLEET_EDGE_SECRET;
  process.env.CONVEX_WORKER_SECRET = 'convex-sec';
  process.env.ALLOW_INSECURE_DEFAULTS = 'true';
  process.env.ASSETTO_ENV = 'dev';
  assert.equal(fleetEdgeSecret(), 'convex-sec');
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  assert.equal(fleetEdgeSecret(), '');
  process.env.FLEET_EDGE_SECRET = 'fleet-sec';
  assert.equal(fleetEdgeSecret(), 'fleet-sec');
  process.env = prev;
});

test('modPeerSecret prefers MOD_PEER_SECRET', () => {
  const prev = { ...process.env };
  process.env.MOD_PEER_SECRET = 'peer';
  process.env.FLEET_EDGE_SECRET = 'fleet';
  process.env.CONVEX_WORKER_SECRET = 'convex';
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  assert.equal(modPeerSecret(), 'peer');
  assert.ok(secretsMatch('peer', modPeerSecret()));
  process.env = prev;
});
