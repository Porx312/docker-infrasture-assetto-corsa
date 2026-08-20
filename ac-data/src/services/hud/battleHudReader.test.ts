import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enrichBattleWithProfiles,
  mapProfileToBattlePlayer,
  normalizeBattlePlayerSnapshot,
} from './battleHudReader.js';
import { buildPlayerCacheKey, buildSessionCacheKey, playerRedisKey, sessionRedisKey } from './hudCacheKeys.js';
import { setFetchHudSessionForTests } from './lapCompletedHudRefresh.js';
import { HUD_SESSION_TTL_SEC, hudRedisDel, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
import type { HudBattleSnapshotOk, HudProfile, HudSessionOk } from './hudTypes.js';

const profile: HudProfile = {
  name: 'Profile Name',
  rank: 3,
  tier: 8,
  best_lap_ms: 120_000,
  car_name: 'Toyota GT86',
  car_id: 'ks_toyota_gt86',
  avatar_url: 'https://example.com/avatar.png',
  steam_id: 'steam-a',
  elo: 1540,
  rivals: { above: null, below: null },
  display_style: { fontId: 'orbitron', effectId: 'gradient', color: '#FFFFFF', gradientColor: '#FF4530' },
  frame_url: 'https://example.com/frame.png',
  input_type: 'wheel',
};

test('normalizeBattlePlayerSnapshot preserves aheadOnTrack from Redis snapshot', () => {
  const ahead = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car: 'ks_toyota_gt86',
    score: 1,
    role: 'lead',
    aheadOnTrack: true,
  });

  assert.equal(ahead.aheadOnTrack, true);
  assert.equal(ahead.role, 'lead');

  const behind = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car: 'ks_toyota_gt86',
    score: 1,
    role: 'lead',
    aheadOnTrack: false,
  });

  assert.equal(behind.aheadOnTrack, false);
});

test('mapProfileToBattlePlayer preserves aheadOnTrack from battle snapshot', () => {
  const base = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car_id: 'legacy_car',
    score: 2,
    role: 'lead',
    aheadOnTrack: false,
  });

  const merged = mapProfileToBattlePlayer(base, profile);

  assert.equal(merged.aheadOnTrack, false);
  assert.equal(merged.role, 'lead');
});

test('normalizeBattlePlayerSnapshot maps legacy car to car_id', () => {
  const normalized = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car: 'ks_toyota_gt86',
    score: 1,
    role: 'lead',
  });

  assert.equal(normalized.car_id, 'ks_toyota_gt86');
  assert.equal(normalized.car_name, 'ks_toyota_gt86');
  assert.equal(normalized.tier, 0);
  assert.equal(normalized.role, 'lead');
});

test('mapProfileToBattlePlayer prefers profile fields', () => {
  const base = normalizeBattlePlayerSnapshot({
    steamId: 'steam-a',
    name: 'Alice',
    car_id: 'legacy_car',
    score: 2,
  });

  const merged = mapProfileToBattlePlayer(base, profile);

  assert.equal(merged.name, 'Profile Name');
  assert.equal(merged.tier, 8);
  assert.equal(merged.elo, 1540);
  assert.equal(merged.avatar_url, 'https://example.com/avatar.png');
  assert.equal(merged.car_id, 'ks_toyota_gt86');
  assert.equal(merged.car_name, 'Toyota GT86');
  assert.equal(merged.score, 2);
  assert.equal(merged.display_style?.fontId, 'orbitron');
  assert.equal(merged.frame_url, 'https://example.com/frame.png');
  assert.equal(merged.input_type, 'wheel');
});

test('normalizeBattlePlayerSnapshot passes through battle cosmetics', () => {
  const normalized = normalizeBattlePlayerSnapshot({
    steamId: 'steam-b',
    name: 'Bob',
    car: 'ks_mazda_miata',
    score: 1,
    display_style: { fontId: 'bebas', effectId: 'solid', color: '#AABBCC' },
    frame_url: 'https://example.com/rival-frame.png',
    input_type: 'controller',
  });

  assert.equal(normalized.display_style?.fontId, 'bebas');
  assert.equal(normalized.frame_url, 'https://example.com/rival-frame.png');
  assert.equal(normalized.input_type, 'controller');
});

test('mapProfileToBattlePlayer keeps snapshot when profile is null', () => {
  const base = normalizeBattlePlayerSnapshot({
    steamId: 'steam-b',
    name: 'Bob',
    car: 'ks_mazda_miata',
    score: 0,
  });

  const merged = mapProfileToBattlePlayer(base, null);

  assert.equal(merged.name, 'Bob');
  assert.equal(merged.tier, 0);
  assert.equal(merged.avatar_url, undefined);
  assert.equal(merged.car_id, 'ks_mazda_miata');
});

function buildBattleSnapshot(state: HudBattleSnapshotOk['state']): HudBattleSnapshotOk {
  return {
    ok: true,
    version: 'battle-v1',
    battleId: 'battle-test-1',
    state,
    serverName: 'Battle',
    track: 'pk_akina',
    trackConfig: 'downhill',
    player1: {
      steamId: '76561199000000011',
      name: 'Alice',
      car_id: 'ks_toyota_gt86',
      score: 0,
    },
    player2: {
      steamId: '76561199000000012',
      name: 'Bob',
      car_id: 'ks_mazda_miata',
      score: 0,
    },
    pointsLog: [],
  };
}

test('enrichBattleWithProfiles prep state does not call Convex on cache miss', async () => {
  if (isHudRedisConfigured()) {
    const snapshot = buildBattleSnapshot('arming');
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: snapshot.player1.steamId })));
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: snapshot.player2.steamId })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: snapshot.player1.steamId })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: snapshot.player2.steamId })));
  }

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  try {
    const battle = await enrichBattleWithProfiles(buildBattleSnapshot('arming'));
    assert.equal(fetchCalls, 0);
    assert.equal(battle.player1.name, 'Alice');
    assert.equal(battle.player2.name, 'Bob');
  } finally {
    setFetchHudSessionForTests(null);
  }
});

test('enrichBattleWithProfiles does not call Convex across repeated battle snapshots', async () => {
  const { isHudConvexConfigured } = await import('./hudConvex.js');
  if (!isHudConvexConfigured() || !isHudRedisConfigured()) {
    return;
  }

  const opponentSteamId = '76561199000000031';
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: opponentSteamId })));

  const cachedOk: HudSessionOk = {
    ok: true,
    version: 'battle-opponent',
    context: {
      server_id: 's1',
      server_name: 'Battle',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: 'downhill',
      layout_name: 'Downhill',
      car_id: 'ks_toyota_gt86',
      car_name: 'GT86',
      player_steam_id: opponentSteamId,
    },
    profile: {
      name: 'Opponent',
      rank: 3,
      tier: 6,
      best_lap_ms: 115_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: opponentSteamId,
      elo: 1500,
      avatar_url: 'https://cdn.example.com/opponent.png',
      rivals: { above: null, below: null },
    },
  };

  await hudRedisSet(
    sessionRedisKey(buildSessionCacheKey({ steamId: opponentSteamId })),
    JSON.stringify(cachedOk),
    300,
  );

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  const snapshot = buildBattleSnapshot('active');
  snapshot.player2.steamId = opponentSteamId;

  try {
    for (let i = 0; i < 3; i += 1) {
      const battle = await enrichBattleWithProfiles(snapshot);
      assert.equal(battle.player2.elo, 1500);
      assert.equal(battle.player2.avatar_url, 'https://cdn.example.com/opponent.png');
    }
    assert.equal(fetchCalls, 0);
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: opponentSteamId })));
  }
});

test('enrichBattleWithProfiles active state does not call Convex on cache miss', async () => {
  const { isHudConvexConfigured } = await import('./hudConvex.js');
  if (!isHudConvexConfigured() || !isHudRedisConfigured()) {
    return;
  }

  const steam1 = '76561199000000021';
  const steam2 = '76561199000000022';
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: steam1 })));
  await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: steam2 })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: steam1 })));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: steam2 })));

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  const snapshot = buildBattleSnapshot('active');
  snapshot.player1.steamId = steam1;
  snapshot.player2.steamId = steam2;

  try {
    const battle = await enrichBattleWithProfiles(snapshot);
    assert.equal(fetchCalls, 0);
    assert.equal(battle.player1.name, 'Alice');
    assert.equal(battle.player2.name, 'Bob');
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: steam1 })));
    await hudRedisDel(playerRedisKey(buildPlayerCacheKey({ steamId: steam2 })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: steam1 })));
    await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId: steam2 })));
  }
});

test('enrichBattleWithProfiles prep uses peek cache when session is cached', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000013';
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const cachedOk: HudSessionOk = {
    ok: true,
    version: 'peek-battle',
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
      name: 'Cached Rival',
      rank: 2,
      tier: 7,
      best_lap_ms: 110_000,
      car_name: 'GT86',
      car_id: 'ks_toyota_gt86',
      steam_id: steamId,
      elo: 1500,
      rivals: { above: null, below: null },
    },
  };
  await hudRedisSet(redisKey, JSON.stringify(cachedOk), HUD_SESSION_TTL_SEC);

  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  const snapshot = buildBattleSnapshot('pairing');
  snapshot.player2.steamId = steamId;

  try {
    const battle = await enrichBattleWithProfiles(snapshot);
    assert.equal(fetchCalls, 0);
    assert.equal(battle.player2.name, 'Cached Rival');
    assert.equal(battle.player2.elo, 1500);
  } finally {
    setFetchHudSessionForTests(null);
    await hudRedisDel(redisKey);
  }
});
