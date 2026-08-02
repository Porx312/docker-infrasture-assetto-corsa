import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPlayerJoin } from './activityNormalize.js';
import {
  clearActivityCachesForTests,
  feedCacheKeyForTests,
} from './activityService.js';

test('feedCacheKeyForTests distinguishes query dimensions', () => {
  clearActivityCachesForTests();
  const base = feedCacheKeyForTests({ day: '2026-08-02', tzOffset: 120, limit: 50 });
  const withQ = feedCacheKeyForTests({
    day: '2026-08-02',
    tzOffset: 120,
    limit: 50,
    q: 'PORX',
  });
  const withCursor = feedCacheKeyForTests({
    day: '2026-08-02',
    tzOffset: 120,
    limit: 50,
    cursor: '1700000000000-0',
  });

  assert.notEqual(base, withQ);
  assert.notEqual(base, withCursor);
  assert.notEqual(withQ, withCursor);
});

test('matchesPlayerJoin matches name steamId car and server', () => {
  const player = {
    steamId: '76561198275021746',
    name: 'PORX',
    firstJoinTs: 1_700_000_000_000,
    serverName: 'testing xd',
    carModel: 'ks_toyota_gt86',
  };

  assert.equal(matchesPlayerJoin(player, 'porx'), true);
  assert.equal(matchesPlayerJoin(player, '76561198275021746'), true);
  assert.equal(matchesPlayerJoin(player, 'toyota'), true);
  assert.equal(matchesPlayerJoin(player, 'testing'), true);
  assert.equal(matchesPlayerJoin(player, 'missing'), false);
  assert.equal(matchesPlayerJoin(player, undefined), true);
});

test('clearActivityCachesForTests resets cache maps', () => {
  clearActivityCachesForTests();
  assert.doesNotThrow(() => clearActivityCachesForTests());
});
