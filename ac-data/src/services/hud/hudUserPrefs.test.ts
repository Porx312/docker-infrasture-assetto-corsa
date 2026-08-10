import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptBattleRedisKey,
  clearUserPrefs,
  profileAcceptBattleEnabled,
  profileSaveTimeEnabled,
  readAcceptBattleEnabled,
  readSaveTimeEnabled,
  saveTimeRedisKey,
  setPublishAcceptBattlePrefChangeForTests,
  syncUserPrefsFromProfile,
  USER_PREFS_TTL_SEC,
} from './hudUserPrefs.js';
import { hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import type { HudProfile } from './hudTypes.js';

const steamId = '76561199000000888';

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

test('saveTimeRedisKey and acceptBattleRedisKey use steamId suffix', () => {
  assert.equal(saveTimeRedisKey('76561199000000001'), 'ac:user:prefs:save_time:76561199000000001');
  assert.equal(
    acceptBattleRedisKey('76561199000000001'),
    'ac:user:prefs:accept_battle:76561199000000001',
  );
});

test('profileSaveTimeEnabled and profileAcceptBattleEnabled default true', () => {
  assert.equal(profileSaveTimeEnabled(baseProfile), true);
  assert.equal(profileAcceptBattleEnabled(baseProfile), true);
  assert.equal(profileSaveTimeEnabled(null), true);
  assert.equal(profileAcceptBattleEnabled(undefined), true);
});

test('profileSaveTimeEnabled and profileAcceptBattleEnabled respect explicit false', () => {
  assert.equal(profileSaveTimeEnabled({ ...baseProfile, saveTime: false }), false);
  assert.equal(profileAcceptBattleEnabled({ ...baseProfile, acceptBattle: false }), false);
});

test('syncUserPrefsFromProfile sets and clears Redis keys', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearUserPrefs(steamId);

  await syncUserPrefsFromProfile(steamId, { ...baseProfile, saveTime: false, acceptBattle: true });
  assert.equal(await hudRedisGet(saveTimeRedisKey(steamId)), '0');
  assert.equal(await hudRedisGet(acceptBattleRedisKey(steamId)), null);
  assert.equal(await readSaveTimeEnabled(steamId), false);
  assert.equal(await readAcceptBattleEnabled(steamId), true);

  await syncUserPrefsFromProfile(steamId, { ...baseProfile, saveTime: true, acceptBattle: false });
  assert.equal(await hudRedisGet(saveTimeRedisKey(steamId)), null);
  assert.equal(await hudRedisGet(acceptBattleRedisKey(steamId)), '0');
  assert.equal(await readSaveTimeEnabled(steamId), true);
  assert.equal(await readAcceptBattleEnabled(steamId), false);

  await clearUserPrefs(steamId);
});

test('syncUserPrefsFromProfile ignores unknown_ steam ids', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const unknownId = 'unknown_xyz';
  await hudRedisDel(saveTimeRedisKey(unknownId));
  await syncUserPrefsFromProfile(unknownId, { ...baseProfile, saveTime: false });
  assert.equal(await hudRedisGet(saveTimeRedisKey(unknownId)), null);
});

test('USER_PREFS_TTL_SEC defaults to one day', () => {
  assert.equal(USER_PREFS_TTL_SEC, 86_400);
});

test('syncUserPrefsFromProfile notifies acceptBattle change on worker push', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const notifications: Array<{ steamId: string; acceptBattle: boolean }> = [];
  setPublishAcceptBattlePrefChangeForTests(async (id, acceptBattle) => {
    notifications.push({ steamId: id, acceptBattle });
  });

  try {
    await clearUserPrefs(steamId);
    await syncUserPrefsFromProfile(steamId, baseProfile, { notifyAcceptBattleChange: true });
    assert.equal(notifications.length, 0);

    await syncUserPrefsFromProfile(
      steamId,
      { ...baseProfile, acceptBattle: false },
      { notifyAcceptBattleChange: true },
    );
    assert.deepEqual(notifications, [{ steamId, acceptBattle: false }]);

    await syncUserPrefsFromProfile(
      steamId,
      { ...baseProfile, acceptBattle: true },
      { notifyAcceptBattleChange: true },
    );
    assert.deepEqual(notifications, [
      { steamId, acceptBattle: false },
      { steamId, acceptBattle: true },
    ]);

    await syncUserPrefsFromProfile(
      steamId,
      { ...baseProfile, acceptBattle: false },
      { notifyAcceptBattleChange: false },
    );
    assert.equal(notifications.length, 2);
  } finally {
    setPublishAcceptBattlePrefChangeForTests(null);
    await clearUserPrefs(steamId);
  }
});
