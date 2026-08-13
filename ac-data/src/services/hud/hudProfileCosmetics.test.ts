import assert from 'node:assert/strict';
import test from 'node:test';

import { profileCosmeticsFingerprint } from './hudProfile.js';
import {
  clearProfileCosmeticsFingerprint,
  profileCosmeticsRedisKey,
  readProfileCosmeticsFingerprint,
  syncProfileCosmeticsFromProfile,
  USER_PROFILE_COSMETICS_TTL_SEC,
} from './hudProfileCosmetics.js';
import { hudRedisGet, isHudRedisConfigured } from './hudRedis.js';
import type { HudProfile } from './hudTypes.js';

const steamId = '76561199000000999';

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

const styledProfile: HudProfile = {
  ...baseProfile,
  display_style: {
    fontId: 'orbitron',
    effectId: 'gradient',
    color: '#FF0000',
  },
  frame_url: 'https://cdn.example.com/frame-a.png',
};

test('profileCosmeticsRedisKey uses steamId suffix', () => {
  assert.equal(
    profileCosmeticsRedisKey('76561199000000001'),
    'ac:user:profile:cosmetics_fp:76561199000000001',
  );
});

test('profileCosmeticsFingerprint includes display_style and frame_url', () => {
  const fp = profileCosmeticsFingerprint(styledProfile);
  assert.match(fp, /orbitron/);
  assert.match(fp, /frame:https:\/\/cdn\.example\.com\/frame-a\.png/);
});

test('USER_PROFILE_COSMETICS_TTL_SEC defaults to one day', () => {
  assert.equal(USER_PROFILE_COSMETICS_TTL_SEC, 86_400);
});

test('syncProfileCosmeticsFromProfile writes and detects frame change', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearProfileCosmeticsFingerprint(steamId);

  const first = await syncProfileCosmeticsFromProfile(steamId, styledProfile);
  assert.equal(first.changed, true);
  assert.equal(first.previous, '');
  assert.equal(first.next, profileCosmeticsFingerprint(styledProfile));
  assert.equal(await hudRedisGet(profileCosmeticsRedisKey(steamId)), first.next);

  const same = await syncProfileCosmeticsFromProfile(steamId, styledProfile, { logChanges: true });
  assert.equal(same.changed, false);

  const frameChanged = await syncProfileCosmeticsFromProfile(
    steamId,
    { ...styledProfile, frame_url: 'https://cdn.example.com/frame-b.png' },
    { logChanges: true },
  );
  assert.equal(frameChanged.changed, true);
  assert.notEqual(frameChanged.previous, frameChanged.next);

  const styleChanged = await syncProfileCosmeticsFromProfile(steamId, {
    ...styledProfile,
    frame_url: 'https://cdn.example.com/frame-b.png',
    display_style: { fontId: 'rajdhani', effectId: 'solid', color: '#00FF00' },
  });
  assert.equal(styleChanged.changed, true);

  await clearProfileCosmeticsFingerprint(steamId);
});

test('syncProfileCosmeticsFromProfile ignores unknown_ steam ids', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const unknownId = 'unknown_cosmetics_test';
  await clearProfileCosmeticsFingerprint(unknownId);
  const result = await syncProfileCosmeticsFromProfile(unknownId, styledProfile);
  assert.equal(result.changed, false);
  assert.equal(await readProfileCosmeticsFingerprint(unknownId), null);
});

test('syncProfileCosmeticsFromProfile clears key when profile has no cosmetics', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await clearProfileCosmeticsFingerprint(steamId);
  await syncProfileCosmeticsFromProfile(steamId, styledProfile);
  assert.notEqual(await hudRedisGet(profileCosmeticsRedisKey(steamId)), null);

  await syncProfileCosmeticsFromProfile(steamId, baseProfile);
  assert.equal(await hudRedisGet(profileCosmeticsRedisKey(steamId)), null);

  await clearProfileCosmeticsFingerprint(steamId);
});
