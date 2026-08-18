import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushHudUpdateForSteamId,
  registerHudPushConnection,
  resetHudPushConnectionsForTests,
  setHudPushHubTestHooks,
} from './hudPushHub.js';
import { setFetchPlayerJoinContextForTests, resetPlayerJoinDedupeForTests } from './playerJoinContext.js';
import { setFetchHudSessionForTests, invalidateHudCachesForSteamId } from './lapCompletedHudRefresh.js';
import { refreshHudUserStatusFromConvex } from './hudUserStatusNotify.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { clearUserInvalidated, readUserInvalidated } from './hudUserInvalidation.js';

const steamId = '76561199000000888';

test('refreshHudUserStatusFromConvex pushes hud_error after Convex invalidates user', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  await clearUserInvalidated(steamId);
  resetPlayerJoinDedupeForTests();

  setFetchPlayerJoinContextForTests(async () => ({
    ok: false,
    reason: 'user_invalidated',
    user: { steamId, isInvalidated: true, name: 'Pilot' },
  }));

  setHudPushHubTestHooks({
    fetchVersion: async () => ({ ok: false, reason: 'user_invalidated' }),
    loadSession: async () => ({ ok: false, reason: 'user_invalidated' }),
  });

  try {
    await refreshHudUserStatusFromConvex(steamId);

    assert.equal(await readUserInvalidated(steamId), true);
    assert.equal(events.length >= 1, true);
    assert.equal(events.at(-1)?.event, 'hud_error');
    assert.equal((events.at(-1)?.data as { reason: string }).reason, 'user_invalidated');
  } finally {
    setFetchPlayerJoinContextForTests(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
    resetPlayerJoinDedupeForTests();
    await clearUserInvalidated(steamId);
  }
});

test('refreshHudUserStatusFromConvex pushes hud_session after Convex re-validates user', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  await clearUserInvalidated(steamId);
  resetPlayerJoinDedupeForTests();
  await invalidateHudCachesForSteamId(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: true,
    user: { steamId, isInvalidated: false, name: 'Pilot' },
    session: {
      ok: true,
      version: 'v-revalidated',
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
    },
  }));

  const sessionPayload = {
    ok: true as const,
    version: 'v-revalidated',
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
    fetchVersion: async () => ({
      ok: true,
      version: 'v-revalidated',
      lbVersion: 'v-revalidated',
      playerVersion: 1,
    }),
    loadSession: async () => sessionPayload,
  });

  try {
    await refreshHudUserStatusFromConvex(steamId);

    assert.equal(await readUserInvalidated(steamId), false);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    assert.equal((sessionEvent.data as { ok: boolean }).ok, true);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    setFetchHudSessionForTests(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
    resetPlayerJoinDedupeForTests();
    await clearUserInvalidated(steamId);
  }
});

test('refreshHudUserStatusFromConvex cosmetics reason bypasses session cache for live fetch', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  let loadSessionBypass: boolean | null = null;

  resetPlayerJoinDedupeForTests();
  await invalidateHudCachesForSteamId(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: true,
    user: { steamId, isInvalidated: false, name: 'Pilot' },
    session: {
      ok: true,
      version: 'v-cosmetics',
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
        frame_url: 'https://cdn.example.com/frames/new.png',
        display_style: { fontId: 'orbitron', effectId: 'solid', color: '#FFF' },
        rivals: { above: null, below: null },
      },
    },
  }));

  const liveSession = {
    ok: true as const,
    version: 'v-cosmetics-live',
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
      frame_url: 'https://cdn.example.com/frames/live.png',
      display_style: { fontId: 'teko', effectId: 'gradient', color: '#F00' },
      rivals: { above: null, below: null },
    },
  };

  setHudPushHubTestHooks({
    fetchVersion: async () => ({
      ok: true,
      version: 'v-cosmetics-live',
      lbVersion: 'v-cosmetics-live',
      playerVersion: 1,
    }),
    loadSession: async (_id, bypassCache) => {
      loadSessionBypass = bypassCache;
      return liveSession;
    },
  });

  try {
    await refreshHudUserStatusFromConvex(steamId, { reason: 'cosmetics', publishEnforcement: true });

    assert.equal(loadSessionBypass, true);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    const payload = sessionEvent.data as { ok: boolean; profile?: { frame_url?: string } };
    assert.equal(payload.ok, true);
    assert.equal(payload.profile?.frame_url, 'https://cdn.example.com/frames/live.png');
  } finally {
    setFetchPlayerJoinContextForTests(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});

test('refreshHudUserStatusFromConvex lap_pb reason prefers session cache after join context', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudPushConnection({
    steamId,
    lastVersionFingerprint: null,
    send: (event, data) => {
      events.push({ event, data });
    },
  });

  let loadSessionBypass: boolean | null = null;

  resetPlayerJoinDedupeForTests();
  await invalidateHudCachesForSteamId(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: true,
    user: { steamId, isInvalidated: false, name: 'Pilot' },
    session: {
      ok: true,
      version: 'v-lap-live',
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
        tier: 6,
        best_lap_ms: 270_000,
        car_name: 'AE86',
        car_id: 'ae86',
        steam_id: steamId,
        rivals: { above: null, below: null },
      },
    },
  }));

  setHudPushHubTestHooks({
    fetchVersion: async () => ({
      ok: true,
      version: 'v-lap-live',
      lbVersion: 'v-lap-live',
      playerVersion: 2,
    }),
    loadSession: async (_id, bypassCache) => {
      loadSessionBypass = bypassCache;
      return {
        ok: true as const,
        version: 'v-lap-live',
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
          tier: 6,
          best_lap_ms: 270_000,
          car_name: 'AE86',
          car_id: 'ae86',
          steam_id: steamId,
          rivals: { above: null, below: null },
        },
      };
    },
  });

  try {
    await refreshHudUserStatusFromConvex(steamId, { reason: 'lap_pb', publishEnforcement: false });

    assert.equal(loadSessionBypass, false);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    const payload = sessionEvent.data as { ok: boolean; profile?: { rank?: number; best_lap_ms?: number } };
    assert.equal(payload.ok, true);
    assert.equal(payload.profile?.rank, 1);
    assert.equal(payload.profile?.best_lap_ms, 270_000);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    setHudPushHubTestHooks(null);
    unregister();
    resetHudPushConnectionsForTests();
  }
});
