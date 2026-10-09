import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetHudEdgeRegistryForTests,
  setDynamicHudEdgeRegistry,
} from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import {
  buildDynamicEntriesForSync,
  mergeDynamicRegistryMaps,
} from '@projectd/ac-data-shared/services/hud/hudRegistrySyncApply.js';
import { isHudRedisConfigured } from '@projectd/ac-data-shared/services/hud/hudRedis.js';
import { resolveHudEdgeForSteamId } from './hudPlayerRouting.js';

const prevFleet = process.env.FLEET_EDGE_REGISTRY;

test('resolveHudEdgeForSteamId uses legacy serverName when Redis unavailable', async () => {
  resetHudEdgeRegistryForTests();
  delete process.env.REDIS_HOST;
  delete process.env.FLEET_EDGE_REGISTRY;

  const entries = buildDynamicEntriesForSync(
    {
      instanceId: 'vps-eu',
      baseUrl: 'http://10.0.0.2:3000',
      publicBaseUrl: 'https://eu.example.com',
      servers: [{ displayName: 'EU Lobby', serverName: 'server-1' }],
    },
    Date.now(),
  );
  setDynamicHudEdgeRegistry(mergeDynamicRegistryMaps(new Map(), 'vps-eu', entries));

  const routing = await resolveHudEdgeForSteamId('76561199000000001', {
    legacyServerName: 'EU Lobby',
  });
  assert.equal(routing.ok, true);
  if (routing.ok) {
    assert.equal(routing.edge.baseUrl, 'http://10.0.0.2:3000');
    assert.equal(routing.publicBaseUrl, 'https://eu.example.com');
  }

  resetHudEdgeRegistryForTests();
  if (prevFleet !== undefined) {
    process.env.FLEET_EDGE_REGISTRY = prevFleet;
  }
});

test('resolveHudEdgeForSteamId without presence or legacy fails', { skip: isHudRedisConfigured() }, async () => {
  const routing = await resolveHudEdgeForSteamId('76561199000000001');
  assert.equal(routing.ok, false);
  if (!routing.ok) {
    assert.equal(routing.reason, 'redis_unavailable');
  }
});
