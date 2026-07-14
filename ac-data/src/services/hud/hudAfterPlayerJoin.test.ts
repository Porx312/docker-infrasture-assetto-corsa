import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlayerCacheKey, buildSessionCacheKey, playerRedisKey, sessionRedisKey } from './hudCacheKeys.js';
import { refreshHudAfterPlayerJoin } from './hudAfterPlayerJoin.js';
import {
  hudErrorCacheTtlSec,
  invalidatePlayerCache,
  invalidateSessionCache,
  refreshSessionCached,
  setFetchHudSessionForTests,
} from './lapCompletedHudRefresh.js';
import {
  applyPlayerJoinContext,
  refreshPlayerJoinFromConvex,
  setFetchPlayerJoinContextForTests,
} from './playerJoinContext.js';
import { HUD_TRANSIENT_ERROR_TTL_SEC, hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import {
  clearUserInvalidated,
  readUserInvalidated,
  userInvalidatedRedisKey,
} from './hudUserInvalidation.js';

const steamId = '76561199000000999';

test('hudErrorCacheTtlSec never caches player_not_connected', () => {
  assert.equal(hudErrorCacheTtlSec('player_not_connected', 300), null);
});

test('hudErrorCacheTtlSec uses short TTL for transient Convex errors', () => {
  assert.equal(hudErrorCacheTtlSec('track_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
  assert.equal(hudErrorCacheTtlSec('server_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
  assert.equal(hudErrorCacheTtlSec('car_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
});

test('hudErrorCacheTtlSec uses default TTL for stable errors', () => {
  assert.equal(hudErrorCacheTtlSec('user_not_found', 300), 300);
});

test('applyPlayerJoinContext marks ban from user.isInvalidated without session', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  await applyPlayerJoinContext(steamId, {
    ok: true,
    user: { steamId, isInvalidated: true, name: 'Pilot' },
    session: { ok: false, reason: 'player_not_connected' },
  });

  assert.equal(await readUserInvalidated(steamId), true);

  await clearUserInvalidated(steamId);
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

test('applyPlayerJoinContext clears ban and seeds session cache when valid', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);
  await markUserInvalidatedForTest(steamId);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  await applyPlayerJoinContext(steamId, {
    ok: true,
    user: { steamId, isInvalidated: false, name: 'Pilot' },
    session: {
      ok: true,
      version: 'v1',
      context: {
        server_id: 's1',
        server_name: 'testing',
        track_id: 'pk_akina',
        track_name: 'Akina',
        layout_id: 'downhill',
        layout_name: 'Downhill',
        car_id: 'ks_toyota_gt86',
        car_name: 'GT86',
        player_steam_id: steamId,
      },
      profile: {
        name: 'Pilot',
        rank: 1,
        tier: 1,
        best_lap_ms: 100_000,
        car_name: 'GT86',
        car_id: 'ks_toyota_gt86',
        steam_id: steamId,
        rivals: { above: null, below: null },
      },
    },
  });

  assert.equal(await readUserInvalidated(steamId), false);
  const sessionCached = await hudRedisGet(sessionRedisKey(buildSessionCacheKey({ steamId })));
  assert.match(sessionCached ?? '', /"ok":true/);

  await clearUserInvalidated(steamId);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

async function markUserInvalidatedForTest(id: string): Promise<void> {
  const { markUserInvalidated } = await import('./hudUserInvalidation.js');
  await markUserInvalidated(id);
}

test('refreshPlayerJoinFromConvex uses unified query mock', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: false,
    reason: 'user_invalidated',
    user: { steamId, isInvalidated: true },
  }));

  await refreshPlayerJoinFromConvex(steamId);
  assert.equal(await readUserInvalidated(steamId), true);

  setFetchPlayerJoinContextForTests(null);
  await clearUserInvalidated(steamId);
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

test('refreshSessionCached marks ban key when Convex returns user_invalidated reason', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  setFetchHudSessionForTests(async () => ({ ok: false, reason: 'user_invalidated' }));

  const result = await refreshSessionCached({ steamId });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'user_invalidated');
  }
  assert.equal(await readUserInvalidated(steamId), true);

  setFetchHudSessionForTests(null);
  await clearUserInvalidated(steamId);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

test('refreshHudAfterPlayerJoin uses unified join context', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisDel(playerKey);
  await hudRedisDel(sessionKey);
  await clearUserInvalidated(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: true,
    user: { steamId, isInvalidated: false },
    session: { ok: false, reason: 'user_not_found' },
  }));

  await refreshHudAfterPlayerJoin(steamId);

  assert.equal(await hudRedisGet(playerKey) !== null, true);
  assert.equal(await hudRedisGet(sessionKey) !== null, true);

  setFetchPlayerJoinContextForTests(null);
  await invalidatePlayerCache({ steamId });
  await invalidateSessionCache({ steamId });
});
