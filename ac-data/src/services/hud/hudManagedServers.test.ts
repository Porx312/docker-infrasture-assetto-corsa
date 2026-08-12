import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  lookupManagedServer,
  resetManagedServersForTests,
  bootstrapManagedServersFromDisk,
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

test('lookupManagedServer returns null when prefix fallback is ambiguous', () => {
  resetManagedServersForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server-x1', displayName: 'PrefixAmbiguous Foo' },
    { serverName: 'server-x2', displayName: 'PrefixAmbiguous Bar' },
  ]);

  assert.equal(lookupManagedServer('PrefixAmbiguous'), null);
});

test('bootstrapManagedServersFromDisk registers server_cfg NAME', () => {
  resetManagedServersForTests();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-managed-'));
  const folder = path.join(tmpRoot, 'server-test');
  const cfgDir = path.join(folder, 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'server_cfg.ini'),
    '[SERVER]\nNAME=Gunsai Testing\n',
    'utf-8',
  );
  try {
    const count = bootstrapManagedServersFromDisk(tmpRoot);
    assert.equal(count, 1);
    const match = lookupManagedServer('Gunsai Testing ℹ18081');
    assert.ok(match);
    assert.equal(match.folderSlug, 'server-test');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
