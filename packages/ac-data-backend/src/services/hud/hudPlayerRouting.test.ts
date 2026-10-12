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

test('prod + ALLOW_INSECURE_DEFAULTS does not reopen legacy routing (AUD2-11)', async () => {
  resetHudEdgeRegistryForTests();
  const prevRedis = process.env.REDIS_HOST;
  const prevEnv = process.env.ASSETTO_ENV;
  const prevInsecure = process.env.ALLOW_INSECURE_DEFAULTS;
  const prevLegacy = process.env.HUD_ALLOW_LEGACY_SERVERNAME_ROUTING;
  delete process.env.REDIS_HOST;
  process.env.ASSETTO_ENV = 'production';
  process.env.ALLOW_INSECURE_DEFAULTS = 'true';
  delete process.env.HUD_ALLOW_LEGACY_SERVERNAME_ROUTING;

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

  try {
    const routing = await resolveHudEdgeForSteamId('76561199000000001', {
      legacyServerName: 'EU Lobby',
    });
    assert.equal(routing.ok, false);
    if (!routing.ok) {
      assert.equal(routing.reason, 'redis_unavailable');
    }
  } finally {
    resetHudEdgeRegistryForTests();
    if (prevRedis === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = prevRedis;
    if (prevEnv === undefined) delete process.env.ASSETTO_ENV;
    else process.env.ASSETTO_ENV = prevEnv;
    if (prevInsecure === undefined) delete process.env.ALLOW_INSECURE_DEFAULTS;
    else process.env.ALLOW_INSECURE_DEFAULTS = prevInsecure;
    if (prevLegacy === undefined) delete process.env.HUD_ALLOW_LEGACY_SERVERNAME_ROUTING;
    else process.env.HUD_ALLOW_LEGACY_SERVERNAME_ROUTING = prevLegacy;
  }
});
