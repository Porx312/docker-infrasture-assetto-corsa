import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDynamicEntriesForSync,
  mergeDynamicRegistryMaps,
  serverNamesFromRegistrySync,
} from './hudRegistrySyncApply.js';
import {
  resetHudEdgeRegistryForTests,
  resolveHudEdgeBaseUrl,
  setDynamicHudEdgeRegistry,
} from './hudEdgeRegistry.js';

test('registry sync indexes displayName and serverName', () => {
  const names = serverNamesFromRegistrySync({
    instanceId: 'vps-eu',
    baseUrl: 'http://10.0.0.2:3000',
    servers: [{ serverName: 'server-2', displayName: 'ProjectD Battles' }],
  });
  assert.ok(names.includes('ProjectD Battles'));
  assert.ok(names.includes('server-2'));
});

test('dynamic registry overrides env when env missing lobby', () => {
  resetHudEdgeRegistryForTests();
  const entries = buildDynamicEntriesForSync(
    {
      instanceId: 'vps-eu',
      baseUrl: 'http://10.0.0.2:3000',
      publicBaseUrl: 'https://eu-api.example.com',
      servers: [{ displayName: 'EU Lobby' }],
    },
    Date.now(),
  );
  setDynamicHudEdgeRegistry(
    mergeDynamicRegistryMaps(new Map(), 'vps-eu', entries),
  );
  assert.equal(resolveHudEdgeBaseUrl('EU Lobby'), 'http://10.0.0.2:3000');
  resetHudEdgeRegistryForTests();
});
