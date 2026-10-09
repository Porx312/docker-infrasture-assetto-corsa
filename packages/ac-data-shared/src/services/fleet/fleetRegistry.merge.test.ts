import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listFleetEdges,
  resetFleetRegistryForTests,
  setRuntimeFleetEdgesFromDb,
} from './fleetRegistry.js';

test('DB overlay fills edges missing from env registry', () => {
  const prev = process.env.FLEET_EDGE_REGISTRY;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: { label: 'EU', baseUrl: 'http://10.0.0.2:3000', instanceId: 'vps-eu-2' },
  });
  resetFleetRegistryForTests();
  setRuntimeFleetEdgesFromDb([
    { id: 'eu', label: 'EU-db', baseUrl: 'http://should-not-win:3000' },
    { id: 'us', label: 'US', baseUrl: 'http://185.187.235.11:3000', instanceId: 'vps-us-1' },
  ]);
  const edges = listFleetEdges();
  const eu = edges.find((e) => e.id === 'eu');
  const us = edges.find((e) => e.id === 'us');
  assert.equal(eu?.baseUrl, 'http://10.0.0.2:3000');
  assert.equal(eu?.label, 'EU');
  assert.equal(us?.baseUrl, 'http://185.187.235.11:3000');
  resetFleetRegistryForTests();
  if (prev !== undefined) process.env.FLEET_EDGE_REGISTRY = prev;
  else delete process.env.FLEET_EDGE_REGISTRY;
});
