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
import { buildHudBootstrapResponse } from './hudBootstrap.js';

test('bootstrap returns direct edge WSS and hub fallback', async () => {
  resetHudEdgeRegistryForTests();
  const prevRedisHost = process.env.REDIS_HOST;
  delete process.env.REDIS_HOST;
  process.env.HUD_PUBLIC_BASE_URL = 'https://hub.example.com';
  const entries = buildDynamicEntriesForSync(
    {
      instanceId: 'vps-eu',
      baseUrl: 'http://10.0.0.2:3000',
      publicBaseUrl: 'https://eu.example.com',
      servers: [{ displayName: 'EU Lobby' }],
    },
    Date.now(),
  );
  setDynamicHudEdgeRegistry(mergeDynamicRegistryMaps(new Map(), 'vps-eu', entries));

  const req = {
    query: { serverName: 'EU Lobby', steamId: '76561199000000001' },
    headers: {},
  } as import('express').Request;

  const body = await buildHudBootstrapResponse(req);
  assert.equal(body.ok, true);
  if (!body.ok) {
    return;
  }
  assert.match(body.ws.primary, /^wss:\/\/eu\.example\.com\/hud\/ws\?/);
  assert.match(body.ws.fallback, /^wss:\/\/hub\.example\.com\/hud\/ws\?/);
  assert.equal(body.instanceId, 'vps-eu');
  resetHudEdgeRegistryForTests();
  delete process.env.HUD_PUBLIC_BASE_URL;
  if (prevRedisHost !== undefined) {
    process.env.REDIS_HOST = prevRedisHost;
  }
});
