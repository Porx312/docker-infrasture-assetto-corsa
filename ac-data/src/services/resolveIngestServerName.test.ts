import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIngestEvent } from './ingestEventBuilder.js';
import {
  lookupManagedServer,
  resetManagedServersForTests,
  updateManagedServersFromSnapshot,
} from './hud/hudManagedServers.js';
import { resolveIngestServerName } from './resolveIngestServerName.js';

test('resolveIngestServerName maps display name to folder slug via managed snapshot', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-4', displayName: 'Battle', type: 'battle' },
  ]);

  assert.equal(resolveIngestServerName('Battle'), 'server-4');
  assert.equal(resolveIngestServerName('Battle ℹ18085'), 'server-4');
  assert.equal(resolveIngestServerName('server-4'), 'server-4');
  assert.equal(lookupManagedServer('Battle')?.folderSlug, 'server-4');
});

test('resolveIngestServerName preserves config sentinel and folder slugs', () => {
  resetManagedServersForTests();
  assert.equal(resolveIngestServerName('__config__'), '__config__');
  assert.equal(resolveIngestServerName('server'), 'server');
  assert.equal(resolveIngestServerName('server-17'), 'server-17');
});

test('buildIngestEvent rewrites serverName for Convex ingest', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-4', displayName: 'Battle', type: 'battle' },
  ]);

  const event = buildIngestEvent({
    event: 'player_join',
    eventId: 'evt-1',
    schemaVersion: '1',
    instanceId: 'vps-eu-2',
    serverName: 'Battle',
    ts: 1,
    data: { steamId: '76561199230780195' },
  });

  assert.equal(event.serverName, 'server-4');
  assert.equal(event.data._meta.serverName, 'server-4');
  assert.equal(event.data.steamId, '76561199230780195');
});
