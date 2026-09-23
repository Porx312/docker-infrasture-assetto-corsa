import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import '../../config/loadEnv.js';
import { handleHudProfileCosmeticsFp } from './hudCosmeticsFp.js';
import { profileCosmeticsRedisKey, syncProfileCosmeticsFromProfile } from './hudProfileCosmetics.js';
import { hudRedisDel, hudRedisGet, isHudRedisConfigured } from './hudRedis.js';

function mockRes(): Response & { body?: unknown; statusCode?: number } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { body?: unknown; statusCode?: number };
}

test('handleHudProfileCosmeticsFp returns Redis fingerprint without Convex', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000999';
  await hudRedisDel(profileCosmeticsRedisKey(steamId));
  await syncProfileCosmeticsFromProfile(steamId, {
    name: 'Pilot',
    rank: 1,
    tier: 1,
    best_lap_ms: 100_000,
    car_name: 'AE86',
    car_id: 'ae86',
    steam_id: steamId,
    rivals: { above: null, below: null },
    display_style: { fontId: 'orbitron', effectId: 'solid', color: '#FFF' },
    frame_url: 'https://cdn.example.com/frame.png',
  });

  const apiKey = process.env.HUD_API_KEY ?? '';
  if (!apiKey) {
    return;
  }

  const req = {
    query: { steamId, api_key: apiKey },
    headers: {},
  } as unknown as Request;
  const res = mockRes();

  await handleHudProfileCosmeticsFp(req, res);

  assert.equal(res.statusCode, 200);
  const body = res.body as { ok: boolean; fingerprint: string | null };
  assert.equal(body.ok, true);
  assert.ok(body.fingerprint?.includes('orbitron'));
  assert.ok(body.fingerprint?.includes('frame:'));

  const redisVal = await hudRedisGet(profileCosmeticsRedisKey(steamId));
  assert.equal(body.fingerprint, redisVal);
  await hudRedisDel(profileCosmeticsRedisKey(steamId));
});

test('handleHudProfileCosmeticsFp self-heals fingerprint from session cache', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const steamId = '76561199000000998';
  const staleFp = 'stale,format,legacy,,,0,default';
  await hudRedisDel(profileCosmeticsRedisKey(steamId));
  await syncProfileCosmeticsFromProfile(steamId, {
    name: 'Pilot',
    rank: 1,
    tier: 1,
    best_lap_ms: 100_000,
    car_name: 'AE86',
    car_id: 'ae86',
    steam_id: steamId,
    rivals: { above: null, below: null },
    display_style: {
      fontId: 'orbitron',
      effectId: 'solid',
      color: '#FFF',
      letterSpacing: '1',
    },
  });

  const { persistSessionCacheResult } = await import('./lapCompletedHudRefresh.js');
  const { sessionRedisKey, buildSessionCacheKey } = await import('./hudCacheKeys.js');
  await persistSessionCacheResult(sessionRedisKey(buildSessionCacheKey({ steamId })), {
    ok: true,
    version: 'v-self-heal',
    context: {
      server_id: 's1',
      server_name: 'testing',
      track_id: 'pk_akina',
      track_name: 'Akina',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 1,
      best_lap_ms: 100_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
      display_style: {
        fontId: 'orbitron',
        effectId: 'solid',
        color: '#FFF',
        letterSpacing: '1',
      },
    },
  });

  const { hudRedisSet } = await import('./hudRedis.js');
  await hudRedisSet(profileCosmeticsRedisKey(steamId), staleFp, 3600);

  const apiKey = process.env.HUD_API_KEY ?? '';
  if (!apiKey) {
    return;
  }

  const req = {
    query: { steamId, api_key: apiKey },
    headers: {},
  } as unknown as Request;
  const res = mockRes();

  await handleHudProfileCosmeticsFp(req, res);

  assert.equal(res.statusCode, 200);
  const body = res.body as { ok: boolean; fingerprint: string | null };
  assert.equal(body.ok, true);
  assert.notEqual(body.fingerprint, staleFp);
  assert.match(body.fingerprint ?? '', /orbitron/);
  assert.match(body.fingerprint ?? '', /,default/);

  const redisVal = await hudRedisGet(profileCosmeticsRedisKey(steamId));
  assert.equal(body.fingerprint, redisVal);
  await hudRedisDel(profileCosmeticsRedisKey(steamId));
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey({ steamId })));
});
