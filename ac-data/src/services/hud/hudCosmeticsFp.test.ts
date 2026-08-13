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
