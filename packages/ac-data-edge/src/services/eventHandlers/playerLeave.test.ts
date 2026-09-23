import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionCacheKey, presenceRedisKey, sessionRedisKey } from '../hud/hudCacheKeys.js';
import {
  noteHudPlayerJoin,
  noteHudPlayerLeave,
  setHudPlayerPresenceTestHooks,
} from '../hud/hudPlayerPresence.js';
import { hudRedisGet, hudRedisSet, isHudRedisConfigured } from '../hud/hudRedis.js';
import { handlePlayerLeaveAfterIngest } from './playerLeave.js';

const steamId = '76561199000000003';

test('noteHudPlayerLeave ignores stale leave when presence car already changed', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  await noteHudPlayerJoin({
    serverName: 'ProjectD',
    data: {
      steamId,
      trackName: 'pk_akina',
      carModel: 'ks_mazda_miata',
    },
  });

  const cleared = await noteHudPlayerLeave({
    serverName: 'ProjectD',
    data: {
      steamId,
      carModel: 'ks_mazda_rx7',
    },
  });

  assert.equal(cleared, false);
  const raw = await hudRedisGet(presenceRedisKey(steamId));
  assert.ok(raw?.includes('ks_mazda_miata'));
});

test('handlePlayerLeaveAfterIngest skips cache invalidation when player reconnected', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const sessionKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisSet(sessionKey, JSON.stringify({ ok: true, version: 'v1' }), 60);

  setHudPlayerPresenceTestHooks(null);
  await noteHudPlayerJoin({
    serverName: 'ProjectD',
    data: {
      steamId,
      trackName: 'pk_akina',
      carModel: 'ks_mazda_miata',
    },
  });

  await handlePlayerLeaveAfterIngest({
    serverName: 'ProjectD',
    data: {
      steamId,
      carModel: 'ks_mazda_rx7',
    },
  });

  const remaining = await hudRedisGet(sessionKey);
  assert.ok(remaining);
});
