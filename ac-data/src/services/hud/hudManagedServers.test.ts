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

test('lookupManagedServer matches when Convex displayName is truncated vs live NAME', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    {
      serverName: 'server',
      displayName:
        'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6',
      type: 'unified',
    },
  ]);

  const liveName =
    'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf ℹ18081';
  const match = lookupManagedServer(liveName);
  assert.ok(match);
  assert.equal(match.folderSlug, 'server');
});

test('lookupManagedServer returns null for unknown server', () => {
  resetManagedServersForTests();
  assert.equal(lookupManagedServer('Random Public Server'), null);
});

test('updateManagedServersFromSnapshot defaults to unified when type omitted', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-2', displayName: 'Akina TA' },
  ]);
  assert.equal(lookupManagedServer('Akina TA')?.type, 'unified');
});
