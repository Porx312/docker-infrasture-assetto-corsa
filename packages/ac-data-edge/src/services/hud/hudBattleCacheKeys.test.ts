import assert from 'node:assert/strict';
import test from 'node:test';

import {
  battleRedisKey,
  battleVersionRedisKey,
  buildBattleCacheKey,
} from './hudCacheKeys.js';

test('buildBattleCacheKey normalizes server name and includes steamId', () => {
  assert.equal(
    buildBattleCacheKey({ serverName: 'Project D', steamId: '76561199000000001' }),
    'project_d:76561199000000001',
  );
});

test('battle redis key prefixes', () => {
  assert.equal(
    battleRedisKey('project_d:76561199000000001'),
    'ac:hud:battle:project_d:76561199000000001',
  );
  assert.equal(
    battleVersionRedisKey('project_d:76561199000000001'),
    'ac:hud:ver:battle:project_d:76561199000000001',
  );
});
