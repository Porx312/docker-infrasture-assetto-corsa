import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlayerCacheKey, playerRedisKey, sessionRedisKey, buildSessionCacheKey } from './hudCacheKeys.js';
import { resetManagedServersForTests, updateManagedServersFromSnapshot } from './hudManagedServers.js';
import {
  registerBattleSsePresence,
  resetBattleSsePresenceForTests,
} from './hudPlayerPresence.js';
import {
  getPlayerCached,
  getSessionCached,
  hudErrorCacheTtlSec,
  isLapPersonalBest,
  patchLastLapInCaches,
  peekSessionCache,
  readCachedProfileBestLapMs,
  readCachedSessionFingerprint,
  refreshSessionCached,
  refreshPlayerHudCache,
  refreshPlayerHudCacheForLap,
  invalidateHudCachesForSteamId,
  sessionHudUnchanged,
  sessionLeaderboardFingerprint,
  setFetchHudSessionForTests,
} from './lapCompletedHudRefresh.js';
import { USER_INVALIDATED_TTL_SEC } from './hudUserInvalidation.js';
import { HUD_PLAYER_NOT_CONNECTED_TTL_SEC, HUD_PLAYER_TTL_SEC, HUD_SESSION_TTL_SEC, hudRedisDel, hudRedisGet, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
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

test('hudErrorCacheTtlSec uses short TTL for player_not_connected', () => {
  assert.equal(hudErrorCacheTtlSec('player_not_connected', 300), HUD_PLAYER_NOT_CONNECTED_TTL_SEC);
});

test('hudErrorCacheTtlSec uses long TTL for user_invalidated', () => {
  assert.equal(hudErrorCacheTtlSec('user_invalidated', 300), USER_INVALIDATED_TTL_SEC);
});

test('peekSessionCache returns null on miss without calling Convex', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000005';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisDel(redisKey);

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  try {
    assert.equal(await peekSessionCache({ steamId }), null);
    assert.equal(fetchCalls, 0);
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(redisKey);
  }
});

test('peekSessionCache returns cached session without calling Convex', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000006';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const cachedOk: HudSessionOk = {
    ok: true,
    version: 'peek-v1',
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

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  try {
    const result = await peekSessionCache({ steamId });
    assert.equal(fetchCalls, 0);
    assert.equal(result?.ok, true);
    assert.equal((result as HudSessionOk).version, 'peek-v1');
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(redisKey);
  }
});

test('peekSessionCache returns player_not_connected without deleting or fetching', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000007';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisSet(
    redisKey,
    JSON.stringify({ ok: false, reason: 'player_not_connected' }),
    HUD_SESSION_TTL_SEC,
  );

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: true, version: 'v-should-not-fetch', context: {}, profile: null };
  });

  try {
    const result = await peekSessionCache({ steamId });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(result, { ok: false, reason: 'player_not_connected' });
    const stillCached = await hudRedisGet(redisKey);
    assert.ok(stillCached);
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(redisKey);
  }
});

test('getSessionCached returns cached player_not_connected without refetch', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000004';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisSet(
    redisKey,
    JSON.stringify({ ok: false, reason: 'player_not_connected' }),
    HUD_PLAYER_NOT_CONNECTED_TTL_SEC,
  );

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return {
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
    };
  });

  try {
    const result = await getSessionCached({ steamId });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(result, { ok: false, reason: 'player_not_connected' });
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(redisKey);
  }
});

test('getPlayerCached returns cached player_not_connected without duplicate Convex fetch', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000008';
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  await hudRedisDel(playerKey);
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'player_not_connected' };
  });

  try {
    const first = await getPlayerCached({ steamId });
    assert.deepEqual(first, { ok: false, reason: 'player_not_connected' });
    assert.equal(fetchCalls, 1);

    const second = await getPlayerCached({ steamId });
    assert.deepEqual(second, { ok: false, reason: 'player_not_connected' });
    assert.equal(fetchCalls, 1);
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(playerKey);
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
  }
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
    source: 'lap',
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

test('sessionLeaderboardFingerprint encodes rank and rivals lap times', () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: params.steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 3,
      tier: 2,
      best_lap_ms: 130_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: params.steamId,
      rivals: {
        above: { rank: 2, name: 'Rival', tier: 3, lap_ms: 125_000, car_name: 'GT86' },
        below: { rank: 4, name: 'Below', tier: 1, lap_ms: 135_000, car_name: 'GT86' },
      },
    },
  };

  assert.equal(sessionLeaderboardFingerprint(session), 'ae86|3:2:125000:4:135000::2');
  assert.equal(sessionHudUnchanged('ae86|3:2:125000:4:135000::2', 'ae86|3:2:125000:4:135000::2'), true);
  assert.equal(sessionHudUnchanged('ae86|3:2:125000:4:135000::2', '2:1:120000:3:130000::2'), false);
  assert.equal(sessionHudUnchanged(null, 'ae86|3:2:125000:4:135000::2'), false);
});

test('sessionLeaderboardFingerprint changes when elo changes with same rank', () => {
  const base: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: params.steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 3,
      tier: 2,
      elo: 1500,
      best_lap_ms: 130_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: params.steamId,
      rivals: {
        above: { rank: 2, name: 'Rival', tier: 3, lap_ms: 125_000, car_name: 'GT86' },
        below: { rank: 4, name: 'Below', tier: 1, lap_ms: 135_000, car_name: 'GT86' },
      },
    },
  };

  const updated: HudSessionOk = {
    ...base,
    profile: { ...base.profile, elo: 1520 },
  };

  const before = sessionLeaderboardFingerprint(base);
  const after = sessionLeaderboardFingerprint(updated);
  assert.notEqual(before, after);
  assert.equal(sessionHudUnchanged(before, after), false);
});

test('sessionLeaderboardFingerprint changes when display_style changes', () => {
  const base: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: params.steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: params.steamId,
      rivals: { above: null, below: null },
      display_style: { fontId: 'rajdhani', effectId: 'solid', color: '#FFFFFF' },
    },
  };

  const updated: HudSessionOk = {
    ...base,
    profile: {
      ...base.profile,
      display_style: { fontId: 'orbitron', effectId: 'gradient', color: '#FF4530', gradientColor: '#FFFFFF' },
    },
  };

  const before = sessionLeaderboardFingerprint(base);
  const after = sessionLeaderboardFingerprint(updated);
  assert.notEqual(before, after);
  assert.equal(sessionHudUnchanged(before, after), false);
});

test('sessionLeaderboardFingerprint changes when car_id changes', () => {
  const base: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ks_mazda_rx7',
      car_name: 'RX7',
      player_steam_id: params.steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 3,
      tier: 2,
      best_lap_ms: 130_000,
      car_name: 'RX7',
      car_id: 'ks_mazda_rx7',
      steam_id: params.steamId,
      rivals: {
        above: { rank: 2, name: 'Rival', tier: 3, lap_ms: 125_000, car_name: 'RX7' },
        below: { rank: 4, name: 'Below', tier: 1, lap_ms: 135_000, car_name: 'RX7' },
      },
    },
  };

  const updated: HudSessionOk = {
    ...base,
    context: { ...base.context, car_id: 'ks_mazda_miata', car_name: 'Miata' },
    profile: { ...base.profile, car_id: 'ks_mazda_miata', car_name: 'Miata' },
  };

  const before = sessionLeaderboardFingerprint(base);
  const after = sessionLeaderboardFingerprint(updated);
  assert.notEqual(before, after);
  assert.equal(sessionHudUnchanged(before, after), false);
});

test('patchLastLapInCaches updates last_lap_ms without invalidating session', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000008';
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 5,
      tier: 2,
      best_lap_ms: 281_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };
  await hudRedisSet(sessionKey, JSON.stringify(session), HUD_SESSION_TTL_SEC);

  const patched = await patchLastLapInCaches({ steamId }, 282_500);
  assert.equal(patched, true);

  const fingerprint = await readCachedSessionFingerprint(steamId);
  assert.equal(fingerprint, '5::::::2');

  const cached = JSON.parse((await hudRedisGet(sessionKey)) ?? '{}') as HudSessionOk;
  assert.equal(cached.profile?.last_lap_ms, 282_500);
  assert.equal(cached.profile?.best_lap_ms, 281_000);

  await hudRedisDel(playerKey);
  await hudRedisDel(sessionKey);
});

test('patchLastLapInCaches does not overwrite best_lap_ms on faster lap patch', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000009';
  const playerKey = playerRedisKey(buildPlayerCacheKey({ steamId }));
  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'test',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 5,
      tier: 2,
      best_lap_ms: 281_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };
  await hudRedisSet(sessionKey, JSON.stringify(session), HUD_SESSION_TTL_SEC);

  const patched = await patchLastLapInCaches({ steamId }, 500);
  assert.equal(patched, true);

  const cached = JSON.parse((await hudRedisGet(sessionKey)) ?? '{}') as HudSessionOk;
  assert.equal(cached.profile?.last_lap_ms, 500);
  assert.equal(cached.profile?.best_lap_ms, 281_000);

  await hudRedisDel(playerKey);
  await hudRedisDel(sessionKey);
});
