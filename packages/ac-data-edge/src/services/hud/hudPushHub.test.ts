import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushHudUpdateForSteamId,
  registerHudPushConnection,
  resetHudPushConnectionsForTests,
  sendInitialHudPushSnapshot,
  setHudPushHubTestHooks,
} from './hudPushHub.js';
import { setHudSessionPresenceTestHooks } from './hudSessionPresence.js';
import type { HudSessionOk, HudVersionOk } from './hudTypes.js';

const steamId = '76561199000000001';

test('pushHudUpdateForSteamId emits hud_version before hud_session', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
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

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);

    assert.equal(events.length, 2);
    assert.equal(events[0]?.event, 'hud_version');
    assert.equal(events[1]?.event, 'hud_session');
    assert.deepEqual((events[0]?.data as { lbVersion: string }).lbVersion, session.version);
    assert.equal((events[1]?.data as { ok: boolean }).ok, true);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId aligns hud_version.version with hud_session.version', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
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

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);

    assert.equal(events.length, 2);
    const versionPayload = events[0]?.data as { version: string; lbVersion: string };
    const sessionPayload = events[1]?.data as { version: string };
    assert.equal(versionPayload.version, session.version);
    assert.equal(sessionPayload.version, session.version);
    assert.equal(versionPayload.lbVersion, session.version);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId skips emit when skipIfSessionUnchanged and fingerprint matches', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: '1::::::5',
    send: (event, data) => {
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
  setHudPushHubTestHooks({
    fetchVersion: async () => {
      fetchVersionCalls += 1;
      return version;
    },
    peekSession: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, { skipIfSessionUnchanged: true });
    assert.equal(events.length, 0);
    assert.equal(fetchVersionCalls, 0);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits when only display_style changes and skipIfSessionUnchanged is set', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const baseProfile = {
    name: 'Pilot',
    rank: 1,
    tier: 5,
    best_lap_ms: 120_000,
    car_name: 'AE86',
    car_id: 'ae86',
    steam_id: steamId,
    rivals: { above: null, below: null },
    display_style: { fontId: 'rajdhani', effectId: 'solid', color: '#FFFFFF' },
  };

  const version: HudVersionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
    lbVersion: 'srv:track:layout:car',
    playerVersion: 42,
  };

  const previousSession: HudSessionOk = {
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
    profile: baseProfile,
  };

  const updatedSession: HudSessionOk = {
    ...previousSession,
    profile: {
      ...baseProfile,
      display_style: { fontId: 'orbitron', effectId: 'gradient', color: '#FF4530', gradientColor: '#FFFFFF' },
    },
  };

  const { sessionLeaderboardFingerprint } = await import('./lapCompletedHudRefresh.js');

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: sessionLeaderboardFingerprint(previousSession),
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => updatedSession,
    loadSession: async () => updatedSession,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, {
      skipIfSessionUnchanged: true,
    });
    assert.equal(events.length >= 1, true);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    const profile = (sessionEvent?.data as { profile?: { display_style?: { fontId?: string } } }).profile;
    assert.equal(profile?.display_style?.fontId, 'orbitron');
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits when only elo changes and skipIfSessionUnchanged is set', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const baseProfile = {
    name: 'Pilot',
    rank: 1,
    tier: 5,
    elo: 1500,
    best_lap_ms: 120_000,
    car_name: 'AE86',
    car_id: 'ae86',
    steam_id: steamId,
    rivals: { above: null, below: null },
  };

  const version: HudVersionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
    lbVersion: 'srv:track:layout:car',
    playerVersion: 42,
  };

  const previousSession: HudSessionOk = {
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
    profile: baseProfile,
  };

  const updatedSession: HudSessionOk = {
    ...previousSession,
    profile: { ...baseProfile, elo: 1480 },
  };

  const { sessionLeaderboardFingerprint } = await import('./lapCompletedHudRefresh.js');

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: sessionLeaderboardFingerprint(previousSession),
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => updatedSession,
    loadSession: async () => updatedSession,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, {
      skipIfSessionUnchanged: true,
    });
    assert.equal(events.length >= 1, true);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    const profile = (sessionEvent?.data as { profile?: { elo?: number } }).profile;
    assert.equal(profile?.elo, 1480);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits when pushReason rival_pb bypasses skipIfSessionUnchanged', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: '1::::::5',
    send: (event, data) => {
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

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, {
      skipIfSessionUnchanged: true,
      pushReason: 'rival_pb',
    });
    assert.equal(events.length >= 1, true);
    assert.ok(events.some((entry) => entry.event === 'hud_session'));
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits when pushReason battle_elo bypasses skipIfSessionUnchanged', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    lastSessionLeaderboardFingerprint: '1::::1500:5',
    send: (event, data) => {
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
      elo: 1520,
      best_lap_ms: 120_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => session,
    loadSession: async () => session,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false, {
      skipIfSessionUnchanged: true,
      pushReason: 'battle_elo',
    });
    assert.equal(events.length >= 1, true);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    const profile = (sessionEvent?.data as { profile?: { elo?: number } }).profile;
    assert.equal(profile?.elo, 1520);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId skips getHudSession when Redis version matches getHudVersion', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
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
  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => cachedSession,
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
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId does not refetch when cached session ok but version mismatch', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  const version: HudVersionOk = {
    ok: true,
    version: 'srv:track:layout:car:2',
    lbVersion: 'srv:track:layout:car',
    playerVersion: 99,
  };

  const cachedSession: HudSessionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
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
      best_lap_ms: 118_000,
      car_name: 'AE86',
      car_id: 'ae86',
      steam_id: steamId,
      rivals: { above: null, below: null },
    },
  };

  let loadCalls = 0;
  setHudPushHubTestHooks({
    fetchVersion: async () => version,
    peekSession: async () => cachedSession,
    loadSession: async () => {
      loadCalls += 1;
      return cachedSession;
    },
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);
    assert.equal(loadCalls, 0);
    assert.equal(events.length, 2);
    assert.equal((events[1]?.data as { version?: string }).version, cachedSession.version);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId fetches session only when cosmetics bypass is set', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  const session: HudSessionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
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
  setHudPushHubTestHooks({
    peekSession: async () => null,
    loadSession: async () => {
      loadCalls += 1;
      return session;
    },
  });

  try {
    await pushHudUpdateForSteamId(steamId, true, { pushReason: 'worker_cosmetics' });

    assert.equal(loadCalls, 1);
    assert.equal(events.length, 2);
    assert.equal(events[1]?.event, 'hud_session');
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId does not fetch Convex on bypass without cosmetics reason', async () => {
  let loadCalls = 0;
  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: () => {},
  });

  const session: HudSessionOk = {
    ok: true,
    version: 'srv:track:layout:car:1',
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

  setHudPushHubTestHooks({
    peekSession: async () => session,
    loadSession: async () => {
      loadCalls += 1;
      return session;
    },
  });

  try {
    await pushHudUpdateForSteamId(steamId, true);
    assert.equal(loadCalls, 0);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId emits nothing when peek cache misses', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  setHudPushHubTestHooks({
    peekSession: async () => null,
  });

  try {
    await pushHudUpdateForSteamId(steamId, false);

    assert.equal(events.length, 0);
  } finally {
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('sendInitialHudPushSnapshot refreshes join context when presence server differs from session cache', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
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

  let joinRefreshCalls = 0;
  setHudSessionPresenceTestHooks({
    getSessionCached: async () => gunsaiCached,
  });
  setHudPushHubTestHooks({
    peekSession: async () => battleSession,
  });
  const { setFetchPlayerJoinContextForTests, resetPlayerJoinDedupeForTests } = await import(
    './playerJoinContext.js'
  );
  resetPlayerJoinDedupeForTests();
  setFetchPlayerJoinContextForTests(async () => {
    joinRefreshCalls += 1;
    return { ok: true, user: { steamId, isInvalidated: false, name: 'Pilot' }, session: battleSession };
  });

  try {
    await sendInitialHudPushSnapshot({ steamId, send: () => {}, lastVersionFingerprint: null }, 'Battle');

    assert.equal(joinRefreshCalls >= 1, true);
    assert.equal(events.length, 2);
    assert.equal((events[1]?.data as { context?: { server_name?: string } }).context?.server_name, 'Battle');
  } finally {
    setFetchPlayerJoinContextForTests(null);
    resetPlayerJoinDedupeForTests();
    setHudSessionPresenceTestHooks(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('sendInitialHudPushSnapshot refreshes join context on cache miss and emits hud_session', async () => {
  const events: Array<{ event: string; data: unknown }> = [];

  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  const version: HudVersionOk = {
    ok: true,
    version: 'battle:track:layout:car:2',
    lbVersion: 'battle:track:layout:car',
    playerVersion: 7,
  };

  const session: HudSessionOk = {
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
      rivals: {
        above: { rank: 3, lap_ms: 125_000, name: 'RivalAbove' },
        below: { rank: 5, lap_ms: 135_000, name: 'RivalBelow' },
      },
    },
  };

  let joinRefreshCalls = 0;
  setHudSessionPresenceTestHooks({
    peekSessionCache: async () => null,
  });
  setHudPushHubTestHooks({
    peekSession: async () => session,
  });
  const { setFetchPlayerJoinContextForTests, resetPlayerJoinDedupeForTests } = await import(
    './playerJoinContext.js'
  );
  resetPlayerJoinDedupeForTests();
  setFetchPlayerJoinContextForTests(async () => {
    joinRefreshCalls += 1;
    return { ok: true, user: { steamId, isInvalidated: false, name: 'Pilot' }, session };
  });

  try {
    await sendInitialHudPushSnapshot({ steamId, send: () => {}, lastVersionFingerprint: null }, 'Battle');

    assert.equal(joinRefreshCalls, 1);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.event, 'hud_version');
    assert.equal(events[1]?.event, 'hud_session');
    const profile = (events[1]?.data as { profile?: { rivals?: unknown } }).profile;
    assert.ok(profile?.rivals);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    resetPlayerJoinDedupeForTests();
    setHudSessionPresenceTestHooks(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('pushHudUpdateForSteamId skips Convex fetch when no push listeners', async () => {
  let versionCalls = 0;
  let loadCalls = 0;

  setHudPushHubTestHooks({
    fetchVersion: async () => {
      versionCalls += 1;
      return { ok: false, reason: 'player_not_connected' };
    },
    loadSession: async () => {
      loadCalls += 1;
      return { ok: false, reason: 'player_not_connected' };
    },
  });

  try {
    await pushHudUpdateForSteamId(steamId, true);
    assert.equal(versionCalls, 0);
    assert.equal(loadCalls, 0);
  } finally {
    setHudPushHubTestHooks(null);
    resetHudPushConnectionsForTests();
  }
});
