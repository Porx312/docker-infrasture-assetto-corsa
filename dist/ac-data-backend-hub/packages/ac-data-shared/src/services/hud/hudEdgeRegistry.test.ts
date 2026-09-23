import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lookupHudEdgeByServerName,
  resetHudEdgeRegistryForTests,
  resolveHudEdgeBaseUrl,
} from './hudEdgeRegistry.js';

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
