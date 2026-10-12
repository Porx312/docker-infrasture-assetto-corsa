import assert from 'node:assert/strict';
import test from 'node:test';

import { isWorkerRequestAuthorized } from '../services/hud/hudWorkerAuth.js';
import { isModAgentRequestAuthorized, modAgentAuthHeaders } from './modAgentAuth.js';

test('modAgentAuthHeaders uses FLEET_EDGE_SECRET under dual-secret strict config', () => {
  const prev = { ...process.env };
  process.env.FLEET_EDGE_SECRET = 'fleet-mod-secret-32chars!!!!!!!!';
  process.env.CONVEX_WORKER_SECRET = 'convex-mod-secret-32chars!!!!!!!';
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  process.env.ASSETTO_ENV = 'production';

  try {
    const headers = modAgentAuthHeaders('vps-eu-2');
    assert.equal(headers['X-Worker-Secret'], 'fleet-mod-secret-32chars!!!!!!!!');
    assert.equal(headers['X-Edge-Id'], 'vps-eu-2');

    const req = {
      headers: {
        'x-worker-secret': headers['X-Worker-Secret'],
        'x-edge-id': headers['X-Edge-Id'],
      },
      body: {},
    } as never;
    assert.equal(isWorkerRequestAuthorized(req), true);
    assert.equal(isModAgentRequestAuthorized(req), true);

    const convexOnly = {
      headers: {
        'x-worker-secret': 'convex-mod-secret-32chars!!!!!!!',
        'x-edge-id': 'vps-eu-2',
      },
      body: {},
    } as never;
    assert.equal(isModAgentRequestAuthorized(convexOnly), false);
  } finally {
    process.env = prev;
  }
});
