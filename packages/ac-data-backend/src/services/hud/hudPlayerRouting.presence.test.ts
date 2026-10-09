import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetHudEdgeRegistryForTests,
  setDynamicHudEdgeRegistry,
} from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  buildDynamicEntriesForSync,
  mergeDynamicRegistryMaps,
} from '@projectd/ac-data-shared/services/hud/hudRegistrySyncApply.js';
import { resolveEdgeFromPresence } from './hudPlayerRouting.js';

const prevFleet = process.env.FLEET_EDGE_REGISTRY;

function seedRegistry(): void {
  resetHudEdgeRegistryForTests();
  resetFleetRegistryForTests();
  const entries = buildDynamicEntriesForSync(
    {
      instanceId: 'vps-eu-2',
      baseUrl: 'http://10.0.0.2:3000',
      publicBaseUrl: 'https://eu.example.com',
      servers: [
        { displayName: 'EU Lobby', serverName: 'server-1', folderSlug: 'server-1' },
      ],
    },
    Date.now(),
  );
  setDynamicHudEdgeRegistry(mergeDynamicRegistryMaps(new Map(), 'vps-eu-2', entries));
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'EU',
      baseUrl: 'http://10.0.0.2:3000',
      instanceId: 'vps-eu-2',
      joinIp: '13.140.160.131',
    },
  });
}

test('resolveEdgeFromPresence prefers instanceId:folderSlug composite', () => {
  seedRegistry();
  const edge = resolveEdgeFromPresence(
    {
      serverName: 'Other Name',
      track: '',
      trackConfig: '',
      carModel: '',
      updatedAt: Date.now(),
      instanceId: 'vps-eu-2',
      folderSlug: 'server-1',
    },
    null,
  );
  assert.ok(edge);
  assert.equal(edge?.baseUrl, 'http://10.0.0.2:3000');
  assert.equal(edge?.publicBaseUrl, 'https://eu.example.com');
  resetHudEdgeRegistryForTests();
  resetFleetRegistryForTests();
  if (prevFleet !== undefined) process.env.FLEET_EDGE_REGISTRY = prevFleet;
  else delete process.env.FLEET_EDGE_REGISTRY;
});

test('resolveEdgeFromPresence falls back to fleet by instanceId', () => {
  seedRegistry();
  const edge = resolveEdgeFromPresence(
    {
      serverName: 'Unknown Lobby',
      track: '',
      trackConfig: '',
      carModel: '',
      updatedAt: Date.now(),
      instanceId: 'vps-eu-2',
    },
    null,
  );
  assert.ok(edge);
  assert.equal(edge?.baseUrl, 'http://10.0.0.2:3000');
  resetHudEdgeRegistryForTests();
  resetFleetRegistryForTests();
  if (prevFleet !== undefined) process.env.FLEET_EDGE_REGISTRY = prevFleet;
  else delete process.env.FLEET_EDGE_REGISTRY;
});

test('resolveEdgeFromPresence returns null when unknown', () => {
  resetHudEdgeRegistryForTests();
  resetFleetRegistryForTests();
  delete process.env.FLEET_EDGE_REGISTRY;
  const edge = resolveEdgeFromPresence(
    {
      serverName: 'Nowhere',
      track: '',
      trackConfig: '',
      carModel: '',
      updatedAt: Date.now(),
      instanceId: 'vps-unknown',
    },
    null,
  );
  assert.equal(edge, null);
  if (prevFleet !== undefined) process.env.FLEET_EDGE_REGISTRY = prevFleet;
});
