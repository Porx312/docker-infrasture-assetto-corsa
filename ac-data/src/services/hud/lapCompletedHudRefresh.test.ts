import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlayerCacheKey, playerRedisKey, sessionRedisKey, buildSessionCacheKey } from './hudCacheKeys.js';
import { resetManagedServersForTests, updateManagedServersFromSnapshot } from './hudManagedServers.js';
import {
  registerBattleSsePresence,
  resetBattleSsePresenceForTests,
} from './hudPlayerPresence.js';
import {
  getSessionCached,
  hudErrorCacheTtlSec,
  isLapPersonalBest,
  readCachedProfileBestLapMs,
  refreshSessionCached,
  refreshPlayerHudCache,
  refreshPlayerHudCacheForLap,
  invalidateHudCachesForSteamId,
  setFetchHudSessionForTests,
} from './lapCompletedHudRefresh.js';
import { USER_INVALIDATED_TTL_SEC } from './hudUserInvalidation.js';
import { HUD_PLAYER_TTL_SEC, HUD_SESSION_TTL_SEC, hudRedisDel, hudRedisGet, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
import type { HudPlayerResult, HudSessionOk } from './hudTypes.js';

const params = { steamId: '76561199000000001' };

test('isLapPersonalBest returns true when cache is empty', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await hudRedisDel(playerRedisKey(buildPlayerCacheKey(params)));
  assert.equal(await isLapPersonalBest(params, 120_000), true);
});

test('isLapPersonalBest returns true when lap beats cached profile best', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const cached: HudPlayerResult = {
    ok: true,
    profile: {
      name: 'Pilot',
      rank: 5,
      tier: 2,
      best_lap_ms: 130_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: params.steamId,
      rivals: { above: null, below: null },
    },
  };
  await hudRedisSet(
    playerRedisKey(buildPlayerCacheKey(params)),
    JSON.stringify(cached),
    HUD_PLAYER_TTL_SEC,
  );

  assert.equal(await readCachedProfileBestLapMs(params), 130_000);
  assert.equal(await isLapPersonalBest(params, 120_000), true);
  assert.equal(await isLapPersonalBest(params, 130_000), false);
  assert.equal(await isLapPersonalBest(params, 140_000), false);

  await hudRedisDel(playerRedisKey(buildPlayerCacheKey(params)));
});

test('hudErrorCacheTtlSec skips caching player_not_connected', () => {
  assert.equal(hudErrorCacheTtlSec('player_not_connected', 300), null);
});

test('hudErrorCacheTtlSec uses long TTL for user_invalidated', () => {
  assert.equal(hudErrorCacheTtlSec('user_invalidated', 300), USER_INVALIDATED_TTL_SEC);
});

test('getSessionCached ignores stale player_not_connected cache entries', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000004';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisSet(
    redisKey,
    JSON.stringify({ ok: false, reason: 'player_not_connected' }),
    HUD_SESSION_TTL_SEC,
  );

  setFetchHudSessionForTests(async () => ({
    ok: true,
    version: 'v2',
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
    profile: null,
  }));

  const result = await getSessionCached({ steamId });
  assert.equal(result.ok, true);
  assert.equal((result as HudSessionOk).version, 'v2');

  setFetchHudSessionForTests(null);
  await hudRedisDel(redisKey);
});

test('refreshSessionCached keeps prior OK cache when Convex returns player_not_connected', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000003';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const cachedOk: HudSessionOk = {
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
    profile: null,
  };

  await hudRedisSet(redisKey, JSON.stringify(cachedOk), HUD_SESSION_TTL_SEC);

  setFetchHudSessionForTests(async () => ({ ok: false, reason: 'player_not_connected' }));

  const result = await refreshSessionCached({ steamId });
  assert.equal(result.ok, true);
  assert.equal((result as HudSessionOk).version, 'v1');

  const stillCached = await hudRedisGet(redisKey);
  assert.ok(stillCached?.includes('"version":"v1"'));

  setFetchHudSessionForTests(null);
  await hudRedisDel(redisKey);
});

test('refreshPlayerHudCacheForLap retries until rivals fingerprint changes', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000005';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const cachedOk: HudSessionOk = {
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
      rank: 10,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: steamId,
      rivals: {
        above: { rank: 9, name: 'Above', tier: 6, lap_ms: 119_000, car_name: 'RX-7' },
        below: null,
      },
    },
  };

  await hudRedisSet(redisKey, JSON.stringify(cachedOk), HUD_SESSION_TTL_SEC);

  let calls = 0;
  setFetchHudSessionForTests(async () => {
    calls += 1;
    if (calls < 3) {
      return cachedOk;
    }
    return {
      ...cachedOk,
      version: 'v2',
      profile: {
        ...cachedOk.profile!,
        rank: 9,
        rivals: {
          above: { rank: 8, name: 'NewAbove', tier: 6, lap_ms: 118_000, car_name: 'RX-7' },
          below: null,
        },
      },
    };
  });

  const result = await refreshPlayerHudCacheForLap({ steamId, source: 'lap' });
  assert.equal(result.session.ok, true);
  assert.equal((result.session as HudSessionOk).profile?.rank, 9);
  assert.equal(result.player.ok, true);
  assert.equal(result.player.profile?.rank, 9);
  assert.ok(calls >= 3);

  setFetchHudSessionForTests(null);
  await hudRedisDel(redisKey);
});

test('refreshPlayerHudCache persists player cache derived from session after retry', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000006';
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisDel(playerKey);
  await hudRedisDel(sessionKey);

  resetManagedServersForTests();
  resetBattleSsePresenceForTests();
  updateManagedServersFromSnapshot([
    { serverName: 'server', displayName: 'testing xd', type: 'time-attack' },
  ]);
  registerBattleSsePresence({
    steamId,
    serverName: 'testing xd',
    track: 'pk_akina',
    trackConfig: 'akina_downhill',
    carModel: 'ks_mazda_rx7_spirit_r',
    updatedAt: Date.now(),
    serverType: 'time-attack',
    folderSlug: 'server',
  });

  let calls = 0;
  setFetchHudSessionForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, reason: 'player_not_connected' };
    }
    return {
      ok: true,
      version: 'v1',
      context: {
        server_id: 's1',
        server_name: 'testing xd',
        track_id: 'pk_akina',
        track_name: 'Akina',
        layout_id: 'akina_downhill',
        layout_name: 'Downhill',
        car_id: 'ks_mazda_rx7_spirit_r',
        car_name: 'RX-7',
        player_steam_id: steamId,
      },
      profile: {
        name: 'Porx',
        rank: 5,
        tier: 3,
        best_lap_ms: 294_026,
        elo: 1180,
        car_name: 'RX-7',
        car_id: 'ks_mazda_rx7_spirit_r',
        steam_id: steamId,
        rivals: {
          above: { rank: 4, name: 'Storm', tier: 4, lap_ms: 280_000, car_name: 'RX-7' },
          below: null,
        },
      },
    };
  });

  const result = await refreshPlayerHudCache({
    steamId,
    source: 'battle',
    retryEloUntilChange: true,
    lastLapMs: 294_026,
  });

  assert.equal(result.player.ok, true);
  assert.equal(result.player.profile?.elo, 1180);
  assert.equal(result.session.ok, true);
  assert.equal(result.session.profile?.rivals.above?.name, 'Storm');
  assert.ok(calls >= 2);

  const cached = await hudRedisGet(playerKey);
  assert.ok(cached?.includes('"elo":1180'));

  setFetchHudSessionForTests(null);
  resetBattleSsePresenceForTests();
  resetManagedServersForTests();
  await hudRedisDel(playerKey);
  await hudRedisDel(sessionKey);
});

test('invalidateHudCachesForSteamId clears player and session redis keys', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000007';
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));

  await hudRedisSet(playerKey, '{"ok":true,"profile":null}', HUD_PLAYER_TTL_SEC);
  await hudRedisSet(sessionKey, '{"ok":true,"version":"v1","context":{},"profile":null}', HUD_SESSION_TTL_SEC);

  await invalidateHudCachesForSteamId(steamId);

  assert.equal(await hudRedisGet(playerKey), null);
  assert.equal(await hudRedisGet(sessionKey), null);
});
