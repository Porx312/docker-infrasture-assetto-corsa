import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resetBattleHudPushForTests,
  setBattleInitialFetcherForTests,
  subscribeBattleHudRoom,
  unsubscribeBattleHudRoom,
} from './battleHudPush.js';
import { battleRoomFromParams } from './hudBattleRooms.js';
import {
  refreshBattleRoomSubscription,
  setBattleRoomPresenceResolverForTests,
  setBattleRoomRefreshPresenceForTests,
} from './hudStreamSseBattleRoom.js';
import type { ResolvedPlayerPresence } from './hudTypes.js';

const STEAM_ID = '76561199000000001';

function mockPresence(serverName: string): ResolvedPlayerPresence {
  return {
    steamId: STEAM_ID,
    serverName,
    track: 'pk_akina',
    trackConfig: 'downhill',
    carModel: 'ks_toyota_gt86',
    updatedAt: Date.now(),
  };
}

test('refreshBattleRoomSubscription resubscribes when serverName changes', async () => {
  resetBattleHudPushForTests();
  setBattleInitialFetcherForTests(async () => ({ ok: false, reason: 'no_battle' }));

  let call = 0;
  setBattleRoomPresenceResolverForTests(async () => {
    call += 1;
    const serverName = call === 1 ? 'server-a' : 'server-b';
    return { ok: true, presence: mockPresence(serverName) };
  });
  setBattleRoomRefreshPresenceForTests(async () => {});

  const listener = () => {};
  const roomA = battleRoomFromParams('server-a', STEAM_ID);

  try {
    const initial = await refreshBattleRoomSubscription(STEAM_ID, { room: roomA, listener });
    assert.ok(initial);
    assert.equal(initial.room, roomA);

    const moved = await refreshBattleRoomSubscription(STEAM_ID, initial);
    assert.ok(moved);
    assert.equal(moved.room, battleRoomFromParams('server-b', STEAM_ID));
    assert.notEqual(moved.room, roomA);
  } finally {
    setBattleRoomPresenceResolverForTests(null);
    setBattleRoomRefreshPresenceForTests(null);
    resetBattleHudPushForTests();
  }
});

test('refreshBattleRoomSubscription keeps room when serverName unchanged', async () => {
  resetBattleHudPushForTests();
  setBattleInitialFetcherForTests(async () => ({ ok: false, reason: 'no_battle' }));

  setBattleRoomPresenceResolverForTests(async () => ({
    ok: true,
    presence: mockPresence('server-a'),
  }));
  setBattleRoomRefreshPresenceForTests(async () => {});

  const listener = () => {};
  const room = battleRoomFromParams('server-a', STEAM_ID);

  try {
    const current = { room, listener };
    const next = await refreshBattleRoomSubscription(STEAM_ID, current);
    assert.equal(next?.room, room);
  } finally {
    setBattleRoomPresenceResolverForTests(null);
    setBattleRoomRefreshPresenceForTests(null);
    resetBattleHudPushForTests();
  }
});
