import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetManagedServersForTests,
  updateManagedServersFromSnapshot,
} from './hudManagedServers.js';
import {
  buildPresenceRecordForTests,
  registerBattleSsePresence,
  resetBattleSsePresenceForTests,
  validateResolvedPresence,
} from './hudPlayerPresence.js';

test('validateResolvedPresence returns player_not_connected without record', () => {
  resetManagedServersForTests();
  const result = validateResolvedPresence('76561199000000001', null);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'player_not_connected');
  }
});

test('validateResolvedPresence returns not_managed_server for unknown lobby', () => {
  resetManagedServersForTests();
  const record = buildPresenceRecordForTests(
    'Unknown Server',
    { trackName: 'pk_akina', trackConfig: 'downhill', carModel: 'ks_toyota_gt86' },
    '76561199000000001',
  );
  const result = validateResolvedPresence('76561199000000001', record);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'not_managed_server');
  }
});

test('validateResolvedPresence accepts any managed server type for HUD', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-2', displayName: 'Battle Test', type: 'battle' },
  ]);
  const record = buildPresenceRecordForTests(
    'Battle Test',
    { trackName: 'pk_akina', trackConfig: '', carModel: 'ks_toyota_gt86' },
    '76561199000000001',
  );

  const result = validateResolvedPresence('76561199000000001', record);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.presence.serverType, 'battle');
    assert.equal(result.presence.track, 'pk_akina');
  }
});

test('buildPresenceRecordForTests normalizes server name', () => {
  const record = buildPresenceRecordForTests(
    'ProjectD ℹ18081',
    { trackName: 'pk_akina', trackConfig: 'downhill' },
    '76561199000000001',
    'ks_toyota_gt86',
  );
  assert.equal(record.serverName, 'ProjectD');
  assert.equal(record.track, 'pk_akina');
});

test('validateResolvedPresence accepts in-memory battle SSE fallback', () => {
  resetManagedServersForTests();
  resetBattleSsePresenceForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-2', displayName: 'ProjectD', type: 'battle' },
  ]);
  registerBattleSsePresence({
    steamId: '76561199000000001',
    serverName: 'ProjectD',
    track: 'pk_akina',
    trackConfig: 'downhill',
    carModel: 'ks_toyota_gt86',
    updatedAt: Date.now(),
    serverType: 'battle',
    folderSlug: 'server-2',
  });

  const result = validateResolvedPresence(
    '76561199000000001',
    {
      serverName: 'ProjectD',
      track: 'pk_akina',
      trackConfig: 'downhill',
      carModel: 'ks_toyota_gt86',
      updatedAt: Date.now(),
    },
  );
  assert.equal(result.ok, true);
  resetBattleSsePresenceForTests();
});
