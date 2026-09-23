import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lookupHudEdgeByInstanceId,
  lookupHudEdgeByServerName,
  resetHudEdgeRegistryForTests,
  resolveHudEdgeBaseUrl,
  setDynamicHudEdgeRegistry,
} from './hudEdgeRegistry.js';
import {
  buildDynamicEntriesForSync,
  mergeDynamicRegistryMaps,
} from './hudRegistrySyncApply.js';

test('HUD_EDGE_REGISTRY resolves server display names', () => {
  const prev = process.env.HUD_EDGE_REGISTRY;
  resetHudEdgeRegistryForTests();
  process.env.HUD_EDGE_REGISTRY = JSON.stringify({
    ProjectD: 'https://edge-eu-1.internal:3000',
  });

  assert.equal(resolveHudEdgeBaseUrl('ProjectD'), 'https://edge-eu-1.internal:3000');
  assert.equal(lookupHudEdgeByServerName('ProjectD')?.baseUrl, 'https://edge-eu-1.internal:3000');

  process.env.HUD_EDGE_REGISTRY = prev;
  resetHudEdgeRegistryForTests();
});

test('dynamic registry resolves by instanceId', () => {
  resetHudEdgeRegistryForTests();
  const entries = buildDynamicEntriesForSync(
    {
      instanceId: 'vps-eu',
      baseUrl: 'http://10.0.0.2:3000',
      publicBaseUrl: 'https://eu.example.com',
      servers: [{ displayName: 'Lobby A', serverName: 'server-1' }],
    },
    Date.now(),
  );
  setDynamicHudEdgeRegistry(mergeDynamicRegistryMaps(new Map(), 'vps-eu', entries));

  const edge = lookupHudEdgeByInstanceId('vps-eu');
  assert.equal(edge?.baseUrl, 'http://10.0.0.2:3000');
  assert.equal(edge?.publicBaseUrl, 'https://eu.example.com');

  resetHudEdgeRegistryForTests();
});
