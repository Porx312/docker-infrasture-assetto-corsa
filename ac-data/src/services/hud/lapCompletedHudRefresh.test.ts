import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlayerCacheKey, playerRedisKey } from './hudCacheKeys.js';
import {
  isLapPersonalBest,
  readCachedProfileBestLapMs,
} from './lapCompletedHudRefresh.js';
import { HUD_PLAYER_TTL_SEC, hudRedisDel, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
import type { HudPlayerResult } from './hudTypes.js';

const params = {
  steamId: '76561199000000001',
  serverName: 'ProjectD',
  track: 'pk_akina',
  trackConfig: 'downhill',
  carModel: 'ks_toyota_gt86',
};

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
