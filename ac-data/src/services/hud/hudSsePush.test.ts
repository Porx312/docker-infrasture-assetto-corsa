import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushHudUpdateForSteamId,
  registerHudSseConnection,
  resetHudSseConnectionsForTests,
  sendInitialHudSseSnapshot,
  setHudSsePushTestHooks,
} from './hudSsePush.js';
import { setHudSessionPresenceTestHooks } from './hudSessionPresence.js';
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

test('pushHudUpdateForSteamId aligns hud_version.version with hud_session.version', async () => {
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
    version: 'board:long:timestamps:1:2:3',
    lbVersion: 'board:long:timestamps',
    playerVersion: 99,
  };

  const session: HudSessionOk = {
    ok: true,
    version: 'board:short:0',
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
    const versionPayload = events[0]?.data as { version: string; lbVersion: string };
    const sessionPayload = events[1]?.data as { version: string };
    assert.equal(versionPayload.version, session.version);
    assert.equal(sessionPayload.version, session.version);
    assert.equal(versionPayload.lbVersion, version.lbVersion);
  } finally {
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId skips emit when skipIfSessionUnchanged and fingerprint matches', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudSseConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: '1::::',
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

  let fetchVersionCalls = 0;
  setHudSsePushTestHooks({
    fetchVersion: async () => {
      fetchVersionCalls += 1;
      return version;
    },
    getSessionCached: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, { skipIfSessionUnchanged: true });
    assert.equal(events.length, 0);
    assert.equal(fetchVersionCalls, 0);
  } finally {
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId skips getHudSession when Redis version matches getHudVersion', async () => {
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
    version: 'srv:track:layout:car:9',
    lbVersion: 'srv:track:layout:car',
    playerVersion: 42,
  };

  const cachedSession: HudSessionOk = {
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
      rank: 3,
      tier: 4,
      best_lap_ms: 118_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  let loadCalls = 0;
  setHudSsePushTestHooks({
    fetchVersion: async () => version,
    getSessionCached: async () => cachedSession,
    loadSession: async () => {
      loadCalls += 1;
      return cachedSession;
    },
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);
    assert.equal(loadCalls, 0);
    assert.equal(events.length, 2);
    assert.equal((events[1]?.data as { profile?: { rank: number } }).profile?.rank, 3);
  } finally {
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId falls back to cached session on transient live failure', async () => {
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

  const cachedSession: HudSessionOk = {
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
      rank: 2,
      tier: 4,
      best_lap_ms: 121_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  let loadCalls = 0;
  setHudSsePushTestHooks({
    fetchVersion: async () => version,
    loadSession: async () => {
      loadCalls += 1;
      return { ok: false, reason: 'server_not_found' };
    },
    getSessionCached: async () => cachedSession,
  });

  try {
    await pushHudUpdateForSteamId(steamId, true);

    assert.equal(loadCalls, 1);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.event, 'hud_version');
    assert.equal(events[1]?.event, 'hud_session');
    assert.equal((events[1]?.data as { profile?: { rank: number } }).profile?.rank, 2);
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

test('sendInitialHudSseSnapshot bypasses cache when presence server differs from session cache', async () => {
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
    version: 'battle:track:layout:car:2',
    lbVersion: 'battle:track:layout:car',
    playerVersion: 7,
  };

  const battleSession: HudSessionOk = {
    ok: true,
    version: version.version,
    context: {
      server_id: 's2',
      server_name: 'Battle',
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
      rank: 4,
      tier: 3,
      best_lap_ms: 130_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  const gunsaiCached: HudSessionOk = {
    ...battleSession,
    version: 'gunsai:track:layout:car:1',
    context: {
      ...battleSession.context,
      server_id: 's1',
      server_name: 'Gunsai Testing',
      track_id: 'pk_gunsai',
      track_name: 'Gunsai',
    },
  };

  let loadBypass = false;
  setHudSessionPresenceTestHooks({
    getSessionCached: async () => gunsaiCached,
  });
  setHudSsePushTestHooks({
    fetchVersion: async () => version,
    loadSession: async (_id, bypassCache) => {
      loadBypass = bypassCache;
      return battleSession;
    },
  });

  try {
    await sendInitialHudSseSnapshot({ steamId, listener: () => {}, lastVersionFingerprint: null }, 'Battle');

    assert.equal(loadBypass, true);
    assert.equal(events.length, 2);
    assert.equal((events[1]?.data as { context?: { server_name?: string } }).context?.server_name, 'Battle');
  } finally {
    setHudSessionPresenceTestHooks(null);
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
  }
});
