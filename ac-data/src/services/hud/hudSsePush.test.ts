import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushHudUpdateForSteamId,
  registerHudSseConnection,
  resetHudSseConnectionsForTests,
  setHudSsePushTestHooks,
} from './hudSsePush.js';
import type { HudSessionOk, HudVersionOk } from './hudTypes.js';

const steamId = '76561199000000001';

test('pushHudUpdateForSteamId emits hud_version before hud_session', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudSseConnection({
    steamId,
    lastVersionFingerprint: null,
    listener: (event, data) => {
      events.push({ event, data });
    },
  });

  const version: HudVersionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
    lbVersion: 'srv:track:layout:car',
    playerVersion: 42,
  };

  const session: HudSessionOk = {
    ok: true,
    version: version.version,
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
      rank: 1,
      tier: 5,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudSsePushTestHooks({
    fetchVersion: async () => version,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);

    assert.equal(events.length, 2);
    assert.equal(events[0]?.event, 'hud_version');
    assert.equal(events[1]?.event, 'hud_session');
    assert.deepEqual((events[0]?.data as { lbVersion: string }).lbVersion, version.lbVersion);
    assert.equal((events[1]?.data as { ok: boolean }).ok, true);
  } finally {
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits hud_error when version fetch fails', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudSseConnection({
    steamId,
    lastVersionFingerprint: null,
    listener: (event, data) => {
      events.push({ event, data });
    },
  });

  setHudSsePushTestHooks({
    fetchVersion: async () => ({ ok: false, reason: 'player_not_connected' }),
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, 'hud_error');
    assert.equal((events[0]?.data as { reason: string }).reason, 'player_not_connected');
  } finally {
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});
