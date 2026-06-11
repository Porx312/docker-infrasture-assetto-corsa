import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLbCacheKey,
  buildPlayerCacheKey,
  buildSessionCacheKey,
  lbRedisKey,
  normalizeHudKeyPart,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';

test('normalizeHudKeyPart lowercases and replaces spaces', () => {
  assert.equal(normalizeHudKeyPart('Project D'), 'project_d');
  assert.equal(normalizeHudKeyPart('  Foo Bar  '), 'foo_bar');
});

test('buildLbCacheKey matches Convex getHudSnapshotsForWorker formula', () => {
  assert.equal(
    buildLbCacheKey({ serverName: 'Project D', track: 'pk_akina', trackConfig: 'downhill' }),
    'project_d@pk_akina@downhill@global',
  );
});

test('buildLbCacheKey includes car filter id', () => {
  assert.equal(
    buildLbCacheKey({
      serverName: 'srv1',
      track: 'pk_akina',
      trackConfig: 'downhill',
      car: 'ks_toyota_gt86',
    }),
    'srv1@pk_akina@downhill@ks_toyota_gt86',
  );
});

test('buildPlayerCacheKey uses normalized server name', () => {
  assert.equal(
    buildPlayerCacheKey({
      steamId: '76561199000000001',
      serverName: 'Project D',
      track: 'pk_akina',
      trackConfig: 'downhill',
      carModel: 'ks_toyota_gt86',
    }),
    '76561199000000001@project_d@pk_akina@downhill@ks_toyota_gt86',
  );
});

test('buildSessionCacheKey includes carFilter and carModel', () => {
  assert.equal(
    buildSessionCacheKey({
      steamId: '76561199000000001',
      serverName: 'srv1',
      track: 'pk_akina',
      trackConfig: 'downhill',
      carFilter: 'global',
      carModel: 'ks_toyota_gt86',
    }),
    '76561199000000001@srv1@pk_akina@downhill@global@ks_toyota_gt86',
  );
});

test('redis key prefixes', () => {
  assert.equal(
    lbRedisKey('project_d@pk_akina@downhill@global'),
    'ac:hud:lb:project_d@pk_akina@downhill@global',
  );
  assert.equal(
    playerRedisKey('76561199000000001@project_d@pk_akina@downhill@'),
    'ac:hud:player:76561199000000001@project_d@pk_akina@downhill@',
  );
  assert.equal(
    sessionRedisKey('76561199000000001@srv1@pk_akina@@global@'),
    'ac:hud:session:76561199000000001@srv1@pk_akina@@global@',
  );
});
