import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  listFleetEdges,
  resetFleetRegistryForTests,
  resolveFleetEdgeByInstanceId,
} from './fleetRegistry.js';

afterEach(() => {
  delete process.env.FLEET_EDGE_REGISTRY;
  delete process.env.HUD_EDGE_REGISTRY;
  resetFleetRegistryForTests();
});

test('resolveFleetEdgeByInstanceId matches instanceId field', () => {
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'EU',
      baseUrl: 'http://10.0.0.2:3000',
      instanceId: 'vps-eu-2',
    },
  });
  resetFleetRegistryForTests();
  const edge = resolveFleetEdgeByInstanceId('vps-eu-2');
  assert.ok(edge);
  assert.equal(edge?.baseUrl, 'http://10.0.0.2:3000');
  assert.equal(listFleetEdges().length, 1);
});
