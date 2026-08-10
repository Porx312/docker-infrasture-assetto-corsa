import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipLapCompletedIngest } from '../eventHandlers/lapCompleted.js';
import {
  clearUserPrefs,
  saveTimeRedisKey,
  syncUserPrefsFromProfile,
} from '../hud/hudUserPrefs.js';
import { hudRedisGet, isHudRedisConfigured } from '../hud/hudRedis.js';
import type { HudProfile } from '../hud/hudTypes.js';

const steamId = '76561199000000777';

const baseProfile: HudProfile = {
  name: 'Alice',
  rank: 1,
  tier: 5,
  best_lap_ms: 100_000,
  car_name: 'AE86',
  car_id: 'ae86',
  steam_id: steamId,
  rivals: { above: null, below: null },
};

test('shouldSkipLapCompletedIngest is false by default', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserPrefs(steamId);
  await syncUserPrefsFromProfile(steamId, baseProfile);

  const skip = await shouldSkipLapCompletedIngest({
    event: 'lap_completed',
    data: { steamId, lapTime: 95_000 },
  });
  assert.equal(skip, false);
});

test('shouldSkipLapCompletedIngest is true when saveTime=false', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await syncUserPrefsFromProfile(steamId, { ...baseProfile, saveTime: false });
  assert.equal(await hudRedisGet(saveTimeRedisKey(steamId)), '0');

  const skip = await shouldSkipLapCompletedIngest({
    event: 'lap_completed',
    data: { steamId, lapTime: 95_000 },
  });
  assert.equal(skip, true);

  await clearUserPrefs(steamId);
});
