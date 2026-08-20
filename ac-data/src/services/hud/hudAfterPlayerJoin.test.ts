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
  resetPlayerJoinDedupeForTests,
  setFetchPlayerJoinContextForTests,
  setJoinContextRetryDelayMsForTests,
} from './playerJoinContext.js';
import { HUD_PLAYER_NOT_CONNECTED_TTL_SEC, HUD_TRANSIENT_ERROR_TTL_SEC, hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import {
  clearUserInvalidated,
  readUserInvalidated,
  userInvalidatedRedisKey,
} from './hudUserInvalidation.js';
import {
  clearUserNotRegistered,
  readUserNotRegistered,
  userNotRegisteredRedisKey,
} from './hudUserNotRegistered.js';

const steamId = '76561199000000999';

test('hudErrorCacheTtlSec uses short TTL for player_not_connected', () => {
  assert.equal(hudErrorCacheTtlSec('player_not_connected', 300), HUD_PLAYER_NOT_CONNECTED_TTL_SEC);
});

test('hudErrorCacheTtlSec uses short TTL for transient Convex errors', () => {
  assert.equal(hudErrorCacheTtlSec('track_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
  assert.equal(hudErrorCacheTtlSec('server_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
  assert.equal(hudErrorCacheTtlSec('car_not_found', 300), HUD_TRANSIENT_ERROR_TTL_SEC);
});

test('hudErrorCacheTtlSec uses default TTL for stable errors', () => {
  assert.equal(hudErrorCacheTtlSec('user_not_found', 300), 300);
});

test('applyPlayerJoinContext marks not-registered on user_not_found', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);
  await clearUserNotRegistered(steamId);
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  await applyPlayerJoinContext(steamId, {
    ok: false,
    reason: 'user_not_found',
  });

  assert.equal(await readUserNotRegistered(steamId), true);
  assert.equal(await readUserInvalidated(steamId), false);

  await clearUserNotRegistered(steamId);
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

test('applyPlayerJoinContext clears both keys when user is valid', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await markUserInvalidatedForTest(steamId);
  await markUserNotRegisteredForTest(steamId);

  await applyPlayerJoinContext(steamId, {
    ok: true,
    user: { steamId, isInvalidated: false, name: 'Pilot' },
    session: { ok: false, reason: 'player_not_connected' },
  });

  assert.equal(await readUserInvalidated(steamId), false);
  assert.equal(await readUserNotRegistered(steamId), false);

  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});

test('applyPlayerJoinContext ban takes precedence over user_not_found', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserInvalidated(steamId);
  await clearUserNotRegistered(steamId);

  await applyPlayerJoinContext(steamId, {
    ok: false,
    reason: 'user_invalidated',
    user: { steamId, isInvalidated: true },
  });

  assert.equal(await readUserInvalidated(steamId), true);
  assert.equal(await readUserNotRegistered(steamId), false);

  await clearUserInvalidated(steamId);
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

async function markUserNotRegisteredForTest(id: string): Promise<void> {
  const { markUserNotRegistered } = await import('./hudUserNotRegistered.js');
  await markUserNotRegistered(id);
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

test('refreshPlayerJoinFromConvex dedupes repeated player_join within 5s', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  resetPlayerJoinDedupeForTests();
  setJoinContextRetryDelayMsForTests(-1);
  await clearUserInvalidated(steamId);

  let fetchCalls = 0;
  setFetchPlayerJoinContextForTests(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      user: { steamId, isInvalidated: false, name: 'Pilot' },
      session: { ok: false, reason: 'player_not_connected' },
    };
  });

  try {
    await refreshPlayerJoinFromConvex(steamId);
    await refreshPlayerJoinFromConvex(steamId);
    await refreshPlayerJoinFromConvex(steamId);
    assert.equal(fetchCalls, 1);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    resetPlayerJoinDedupeForTests();
    await clearUserInvalidated(steamId);
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
  }
});

test('refreshPlayerJoinFromConvex bypasses dedupe for worker publishEnforcement', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  resetPlayerJoinDedupeForTests();
  setJoinContextRetryDelayMsForTests(-1);
  await clearUserInvalidated(steamId);

  let fetchCalls = 0;
  setFetchPlayerJoinContextForTests(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      user: { steamId, isInvalidated: false, name: 'Pilot' },
      session: { ok: false, reason: 'player_not_connected' },
    };
  });

  try {
    await refreshPlayerJoinFromConvex(steamId);
    await refreshPlayerJoinFromConvex(steamId, { publishEnforcement: true });
    assert.equal(fetchCalls, 2);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    resetPlayerJoinDedupeForTests();
    await clearUserInvalidated(steamId);
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
  }
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

test('refreshPlayerJoinFromConvex retries once when join returns player_not_connected', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  resetPlayerJoinDedupeForTests();
  setJoinContextRetryDelayMsForTests(0);
  await clearUserInvalidated(steamId);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  let fetchCalls = 0;
  setFetchPlayerJoinContextForTests(async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return {
        ok: true,
        user: { steamId, isInvalidated: false, name: 'Pilot' },
        session: { ok: false, reason: 'player_not_connected' },
      };
    }
    return {
      ok: true,
      user: { steamId, isInvalidated: false, name: 'Pilot' },
      session: {
        ok: true,
        version: 'v1',
        context: {
          server_id: 's1',
          server_name: 'Battle',
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
          rank: 2,
          tier: 5,
          best_lap_ms: 120_000,
          car_name: 'GT86',
          car_id: 'ks_toyota_gt86',
          steam_id: steamId,
          elo: 1420,
          avatar_url: 'https://cdn.example.com/a.png',
          rivals: { above: null, below: null },
        },
      },
    };
  });

  try {
    await refreshPlayerJoinFromConvex(steamId);
    const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
    let sessionCached: string | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (fetchCalls >= 2) {
        sessionCached = await hudRedisGet(sessionKey);
        if (sessionCached?.includes('"ok":true')) {
          break;
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(fetchCalls, 2);
    assert.match(sessionCached ?? '', /"ok":true/);
    assert.match(sessionCached ?? '', /1420/);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    resetPlayerJoinDedupeForTests();
    await clearUserInvalidated(steamId);
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
  }
});
