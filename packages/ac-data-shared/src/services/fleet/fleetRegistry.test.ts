import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  listFleetEdges,
  resetFleetRegistryForTests,
  resolveFleetEdgeByInstanceId,
  resolveFleetJoinIp,
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

test('resolveFleetJoinIp uses joinIp override when baseUrl is private', () => {
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'EU',
      baseUrl: 'http://10.0.0.2:3000',
      instanceId: 'vps-eu-2',
      joinIp: '13.140.160.131',
    },
  });
  resetFleetRegistryForTests();
  const edge = resolveFleetEdgeByInstanceId('vps-eu-2');
  assert.ok(edge);
  assert.equal(edge?.joinIp, '13.140.160.131');
  assert.equal(resolveFleetJoinIp(edge!), '13.140.160.131');
});

test('resolveFleetJoinIp falls back to public baseUrl hostname', () => {
  assert.equal(
    resolveFleetJoinIp({
      id: 'eu',
      label: 'EU',
      baseUrl: 'http://13.140.160.131:3000',
      instanceId: 'vps-eu-2',
    }),
    '13.140.160.131',
  );
  assert.equal(
    resolveFleetJoinIp({
      id: 'eu',
      label: 'EU',
      baseUrl: 'http://10.0.0.2:3000',
    }),
    null,
  );
});
