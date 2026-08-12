import assert from 'node:assert/strict';
import test from 'node:test';

import {
  setHudSessionPresenceTestHooks,
  shouldBypassSessionCacheForPresence,
  sessionContextServerName,
} from './hudSessionPresence.js';
import type { HudSessionOk } from './hudTypes.js';

const steamId = '76561199000000001';

test('shouldBypassSessionCacheForPresence returns false when cache missing', async () => {
  setHudSessionPresenceTestHooks({
    getSessionCached: async () => ({ ok: false, reason: 'player_not_connected' }),
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Battle'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassSessionCacheForPresence returns false when servers match', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    getSessionCached: async () => session,
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Gunsai Testing'), false);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('shouldBypassSessionCacheForPresence returns true when presence server differs from cache', async () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSessionPresenceTestHooks({
    getSessionCached: async () => session,
  });
  try {
    assert.equal(await shouldBypassSessionCacheForPresence(steamId, 'Battle'), true);
  } finally {
    setHudSessionPresenceTestHooks(null);
  }
});

test('sessionContextServerName normalizes cached session server name', () => {
  const session: HudSessionOk = {
    ok: true,
    version: 'v1',
    context: {
      server_id: 's1',
      server_name: '  Battle  ',
      track_id: 'pk_battle',
      track_name: 'Battle',
      layout_id: '',
      layout_name: '',
      car_id: 'ae86',
      car_name: 'AE86',
      player_steam_id: steamId,
    },
    profile: {
      name: 'Pilot',
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  assert.equal(sessionContextServerName(session), 'Battle');
});
