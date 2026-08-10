import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pushBattleToRoom,
  resetBattleHudPushForTests,
  setBattleFetcherForTests,
  subscribeBattleHudRoom,
  unsubscribeBattleHudRoom,
} from './battleHudPush.js';
import type { HudBattleOk } from './hudTypes.js';

const ROOM = 'battle:testing:76561199000000001';

test('pushBattleToRoom emits battle and schedules clear on finished', async () => {
  resetBattleHudPushForTests();

  const roomEvents: Array<{ event: string; payload: unknown }> = [];
  const listener = (event: 'battle', payload: unknown) => {
    roomEvents.push({ event, payload });
  };
  subscribeBattleHudRoom(ROOM, listener);

  const snapshot: HudBattleOk = {
    ok: true,
    version: '1',
    battleId: 'battle-1',
    state: 'finished',
    serverName: 'testing',
    track: 'pk_akina',
    trackConfig: 'downhill',
    player1: {
      steamId: 'a',
      name: 'A',
      tier: 0,
      car_id: 'car',
      car_name: 'car',
      score: 1,
    },
    player2: {
      steamId: 'b',
      name: 'B',
      tier: 0,
      car_id: 'car',
      car_name: 'car',
      score: 0,
    },
    pointsLog: [],
    status: 'finished',
    winnerSteamId: 'a',
  };

  let fetchCalls = 0;
  setBattleFetcherForTests(async () => {
    fetchCalls += 1;
    if (fetchCalls <= 2) {
      return snapshot;
    }
    return { ok: false, reason: 'no_battle' };
  });
  process.env.HUD_BATTLE_CLEAR_DELAY_SEC = '0';

  try {
    await pushBattleToRoom(ROOM);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(roomEvents.length, 3);
    assert.equal(roomEvents[0]?.event, 'battle');
    assert.deepEqual(roomEvents[0]?.payload, snapshot);
    assert.equal(roomEvents[1]?.event, 'battle');
    assert.deepEqual(roomEvents[1]?.payload, snapshot);
    assert.equal(roomEvents[2]?.event, 'battle');
    assert.deepEqual(roomEvents[2]?.payload, { ok: false, reason: 'no_battle' });
  } finally {
    unsubscribeBattleHudRoom(ROOM, listener);
    resetBattleHudPushForTests();
  }
});

test('scheduleBattleClear repushes terminal snapshot before no_battle', async () => {
  resetBattleHudPushForTests();

  const roomEvents: Array<{ event: string; payload: unknown }> = [];
  const listener = (event: 'battle', payload: unknown) => {
    roomEvents.push({ event, payload });
  };
  subscribeBattleHudRoom(ROOM, listener);

  const finished: HudBattleOk = {
    ok: true,
    version: '2',
    battleId: 'battle-2',
    state: 'finished',
    serverName: 'testing',
    track: 'pk_akina',
    trackConfig: 'downhill',
    player1: {
      steamId: 'a',
      name: 'A',
      tier: 0,
      car_id: 'car',
      car_name: 'car',
      score: 2,
    },
    player2: {
      steamId: 'b',
      name: 'B',
      tier: 0,
      car_id: 'car',
      car_name: 'car',
      score: 1,
    },
    pointsLog: [],
    status: 'finished',
    winnerSteamId: 'a',
  };

  let fetchCalls = 0;
  setBattleFetcherForTests(async () => {
    fetchCalls += 1;
    if (fetchCalls <= 2) {
      return finished;
    }
    return { ok: false, reason: 'no_battle' };
  });
  process.env.HUD_BATTLE_CLEAR_DELAY_SEC = '0';

  try {
    await pushBattleToRoom(ROOM);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(roomEvents.length, 3);
    assert.deepEqual(roomEvents[0]?.payload, finished);
    assert.deepEqual(roomEvents[1]?.payload, finished);
    assert.deepEqual(roomEvents[2]?.payload, { ok: false, reason: 'no_battle' });
  } finally {
    unsubscribeBattleHudRoom(ROOM, listener);
    resetBattleHudPushForTests();
  }
});

test('pushBattleToRoom emits battle when snapshot missing', async () => {
  resetBattleHudPushForTests();

  const roomEvents: Array<{ event: string; payload: unknown }> = [];
  const listener = (event: 'battle', payload: unknown) => {
    roomEvents.push({ event, payload });
  };
  subscribeBattleHudRoom(ROOM, listener);

  setBattleFetcherForTests(async () => ({ ok: false, reason: 'no_battle' }));

  try {
    await pushBattleToRoom(ROOM);
    assert.deepEqual(roomEvents, [{ event: 'battle', payload: { ok: false, reason: 'no_battle' } }]);
  } finally {
    unsubscribeBattleHudRoom(ROOM, listener);
    resetBattleHudPushForTests();
  }
});
