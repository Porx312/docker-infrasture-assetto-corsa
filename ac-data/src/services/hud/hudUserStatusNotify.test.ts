import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushHudUpdateForSteamId,
  registerHudSseConnection,
  resetHudSseConnectionsForTests,
  setHudSsePushTestHooks,
} from './hudSsePush.js';
import { setFetchPlayerJoinContextForTests } from './playerJoinContext.js';
import { refreshHudUserStatusFromConvex } from './hudUserStatusNotify.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { clearUserInvalidated, readUserInvalidated } from './hudUserInvalidation.js';

const steamId = '76561199000000888';

test('refreshHudUserStatusFromConvex pushes hud_error after Convex invalidates user', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudSseConnection({
    steamId,
    lastVersionFingerprint: null,
    listener: (event, data) => {
      events.push({ event, data });
    },
  });

  await clearUserInvalidated(steamId);

  setFetchPlayerJoinContextForTests(async () => ({
    ok: false,
    reason: 'user_invalidated',
    user: { steamId, isInvalidated: true, name: 'Pilot' },
  }));

  try {
    await refreshHudUserStatusFromConvex(steamId);

    assert.equal(await readUserInvalidated(steamId), true);
    assert.equal(events.length >= 1, true);
    assert.equal(events.at(-1)?.event, 'hud_error');
    assert.equal((events.at(-1)?.data as { reason: string }).reason, 'user_invalidated');
  } finally {
    setFetchPlayerJoinContextForTests(null);
    setHudSsePushTestHooks(null);
    unregister();
    resetHudSseConnectionsForTests();
    await clearUserInvalidated(steamId);
  }
});

test('refreshHudUserStatusFromConvex pushes hud_session after Convex re-validates user', async () => {
  if (!isHudRedisConfigured()) {
    return;
  }

  const events: Array<{ event: string; data: unknown }> = [];
  const unregister = registerHudSseConnection({
    steamId,
    lastVersionFingerprint: null,
    listener: (event, data) => {
      events.push({ event, data });
    },
  });

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

  try {
    await refreshHudUserStatusFromConvex(steamId);

    assert.equal(await readUserInvalidated(steamId), false);
    const sessionEvent = events.find((entry) => entry.event === 'hud_session');
    assert.ok(sessionEvent);
    assert.equal((sessionEvent.data as { ok: boolean }).ok, true);
  } finally {
    setFetchPlayerJoinContextForTests(null);
    unregister();
    resetHudSseConnectionsForTests();
    await clearUserInvalidated(steamId);
  }
});
