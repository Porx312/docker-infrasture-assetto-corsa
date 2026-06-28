import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBoardCacheKey,
  buildPlayerCacheKey,
  buildSessionCacheKey,
  normalizeHudKeyPart,
  playerRedisKey,
  sessionRedisKey,
  presenceRedisKey,
  presenceRosterRedisKey,
} from './hudCacheKeys.js';

test('normalizeHudKeyPart lowercases and replaces spaces', () => {
  assert.equal(normalizeHudKeyPart('Project D'), 'project_d');
  assert.equal(normalizeHudKeyPart('  Foo Bar  '), 'foo_bar');
});

test('buildBoardCacheKey matches board scope formula', () => {
  assert.equal(
    buildBoardCacheKey({ serverName: 'Project D', track: 'pk_akina', trackConfig: 'downhill' }),
    'project_d@pk_akina@downhill@global',
  );
});

test('buildBoardCacheKey includes car filter id', () => {
  assert.equal(
    buildBoardCacheKey({
      serverName: 'srv1',
      track: 'pk_akina',
      trackConfig: 'downhill',
      car: 'ks_toyota_gt86',
    }),
    'srv1@pk_akina@downhill@ks_toyota_gt86',
  );
});

test('buildPlayerCacheKey is steamId only', () => {
  assert.equal(
    buildPlayerCacheKey({ steamId: '76561199000000001' }),
    '76561199000000001',
  );
});

test('buildSessionCacheKey is steamId only', () => {
  assert.equal(
    buildSessionCacheKey({ steamId: '76561199000000001' }),
    '76561199000000001',
  );
});

test('redis key prefixes', () => {
  assert.equal(
    playerRedisKey('76561199000000001'),
    'ac:hud:player:76561199000000001',
  );
  assert.equal(
    sessionRedisKey('76561199000000001'),
    'ac:hud:session:76561199000000001',
  );
});

test('presence redis key prefixes', () => {
  assert.equal(
    presenceRedisKey('76561199000000001'),
    'ac:hud:presence:76561199000000001',
  );
  assert.equal(
    presenceRosterRedisKey('project_d'),
    'ac:hud:presence:roster:project_d',
  );
});
