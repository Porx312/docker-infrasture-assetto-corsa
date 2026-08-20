import assert from 'node:assert/strict';
import test from 'node:test';

import {
  flushHudRefreshQueueForTests,
  getHudRefreshQueueSizeForTests,
  resetHudRefreshSchedulerForTests,
  scheduleHudRefreshAfterBattleFinished,
  scheduleHudRefreshAfterLap,
} from './hudRefreshScheduler.js';
import { setRivalFanoutHandlerForTests } from './hudRivalFanout.js';
import { setFetchHudSessionForTests } from './lapCompletedHudRefresh.js';

test('scheduleHudRefreshAfterLap queues board and player without top10', () => {
  resetHudRefreshSchedulerForTests();
  process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED = 'true';

  try {
    scheduleHudRefreshAfterLap({
    serverName: 'testing',
    data: {
      trackName: 'pk_akina',
      trackConfig: 'downhill',
      carModel: 'ks_toyota_gt86',
      steamId: '76561199000000001',
    },
  });

  const { players, boards } = getHudRefreshQueueSizeForTests();
  assert.equal(players, 1);
  assert.equal(boards, 1);
  } finally {
    delete process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED;
  }
});

test('scheduleHudRefreshAfterLap ignores incomplete lap payload', () => {
  resetHudRefreshSchedulerForTests();
  process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED = 'true';

  try {
    scheduleHudRefreshAfterLap({ serverName: 'testing', data: {} });

  const { players, boards } = getHudRefreshQueueSizeForTests();
  assert.equal(players, 0);
  assert.equal(boards, 0);
  } finally {
    delete process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED;
  }
});

test('scheduleHudRefreshAfterLap is no-op when HUD_LAP_AC_DATA_REFRESH_ENABLED=false', () => {
  resetHudRefreshSchedulerForTests();
  process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED = 'false';

  try {
    scheduleHudRefreshAfterLap({
      serverName: 'testing',
      data: {
        trackName: 'pk_akina',
        steamId: '76561199000000001',
      },
    });

    const { players, boards } = getHudRefreshQueueSizeForTests();
    assert.equal(players, 0);
    assert.equal(boards, 0);
  } finally {
    delete process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED;
  }
});

test('scheduleHudRefreshAfterBattleFinished queues both players', () => {
  resetHudRefreshSchedulerForTests();

  scheduleHudRefreshAfterBattleFinished({
    serverName: 'ProjectD',
    data: {
      track: 'pk_akina',
      trackConfig: 'downhill',
      player1SteamId: '76561199000000001',
      player2SteamId: '76561199000000002',
      player1Car: 'ks_toyota_gt86',
      player2Car: 'ks_toyota_gt86',
    },
  });

  const { players, boards } = getHudRefreshQueueSizeForTests();
  assert.equal(players, 2);
  assert.equal(boards, 0);
});

test('scheduleHudRefreshAfterBattleFinished ignores unknown steam ids', () => {
  resetHudRefreshSchedulerForTests();

  scheduleHudRefreshAfterBattleFinished({
    serverName: 'ProjectD',
    data: {
      track: 'pk_akina',
      player1SteamId: 'unknown_0',
      player2SteamId: '',
    },
  });

  const { players } = getHudRefreshQueueSizeForTests();
  assert.equal(players, 0);
});

test('flushHudRefreshQueueForTests skips battle session refresh without ws listeners', async () => {
  resetHudRefreshSchedulerForTests();
  let fetchCalls = 0;
  setFetchHudSessionForTests(async () => {
    fetchCalls += 1;
    return { ok: false, reason: 'user_not_found' };
  });

  process.env.HUD_BATTLE_REFRESH_DELAY_MS = '0';

  try {
    scheduleHudRefreshAfterBattleFinished({
      serverName: 'ProjectD',
      data: {
        track: 'pk_akina',
        trackConfig: 'downhill',
        player1SteamId: '76561199000000001',
        player2SteamId: '76561199000000002',
        player1Car: 'ks_toyota_gt86',
        player2Car: 'ks_mazda_rx7',
      },
    });

    await flushHudRefreshQueueForTests();
    assert.equal(fetchCalls, 0);
  } finally {
    delete process.env.HUD_BATTLE_REFRESH_DELAY_MS;
    setFetchHudSessionForTests(null);
    resetHudRefreshSchedulerForTests();
  }
});

test('flushHudRefreshQueueForTests invokes rival fan-out for lap boards', async () => {
  resetHudRefreshSchedulerForTests();
  const fanoutCalls: Array<{ serverName: string; authors: string[] }> = [];
  setRivalFanoutHandlerForTests(async (board, authors) => {
    fanoutCalls.push({
      serverName: board.serverName,
      authors: authors.map((author) => author.steamId),
    });
    return 1;
  });

  process.env.HUD_LAP_REFRESH_DELAY_MS = '0';
  process.env.HUD_BATTLE_REFRESH_DELAY_MS = '0';
  process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED = 'true';

  try {
    scheduleHudRefreshAfterLap({
      serverName: 'Akina TA',
      data: {
        trackName: 'pk_akina',
        trackConfig: 'akina_downhill',
        carModel: 'ks_mazda_gt86',
        steamId: '76561199000000001',
        lapTime: 272150,
        isPersonalBest: true,
      },
    });

    await flushHudRefreshQueueForTests();

    assert.equal(fanoutCalls.length, 1);
    assert.equal(fanoutCalls[0]?.serverName, 'Akina TA');
    assert.deepEqual(fanoutCalls[0]?.authors, ['76561199000000001']);
  } finally {
    delete process.env.HUD_LAP_REFRESH_DELAY_MS;
    delete process.env.HUD_BATTLE_REFRESH_DELAY_MS;
    delete process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED;
    setRivalFanoutHandlerForTests(null);
    resetHudRefreshSchedulerForTests();
  }
});

test('flushHudRefreshQueueForTests skips rival fan-out for non-PB laps', async () => {
  resetHudRefreshSchedulerForTests();
  const fanoutCalls: Array<{ serverName: string; authors: string[] }> = [];
  setRivalFanoutHandlerForTests(async (board, authors) => {
    fanoutCalls.push({
      serverName: board.serverName,
      authors: [...authors],
    });
    return 0;
  });

  process.env.HUD_LAP_REFRESH_DELAY_MS = '0';
  process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED = 'true';

  try {
    scheduleHudRefreshAfterLap({
      serverName: 'Akina TA',
      data: {
        trackName: 'pk_akina',
        trackConfig: 'akina_downhill',
        carModel: 'ks_mazda_gt86',
        steamId: '76561199000000001',
        lapTime: 281_000,
        isPersonalBest: false,
      },
    });

    await flushHudRefreshQueueForTests();

    assert.equal(fanoutCalls.length, 0);
  } finally {
    delete process.env.HUD_LAP_REFRESH_DELAY_MS;
    delete process.env.HUD_LAP_AC_DATA_REFRESH_ENABLED;
    setRivalFanoutHandlerForTests(null);
    resetHudRefreshSchedulerForTests();
  }
});
