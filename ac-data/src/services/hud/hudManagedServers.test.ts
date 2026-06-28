import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lookupManagedServer,
  resetManagedServersForTests,
  updateManagedServersFromSnapshot,
} from './hudManagedServers.js';

test('updateManagedServersFromSnapshot indexes by displayName', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    {
      serverName: 'server-1',
      displayName: 'ProjectD |Akina',
      type: 'time-attack',
    },
  ]);

  const match = lookupManagedServer('ProjectD |Akina ℹ18081');
  assert.ok(match);
  assert.equal(match.folderSlug, 'server-1');
  assert.equal(match.type, 'time-attack');
});

test('lookupManagedServer returns null for unknown server', () => {
  resetManagedServersForTests();
  assert.equal(lookupManagedServer('Random Public Server'), null);
});

test('lookupManagedServer distinguishes battle vs time-attack', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-2', displayName: 'Battle Test', type: 'battle' },
  ]);
  assert.equal(lookupManagedServer('Battle Test')?.type, 'battle');
});
