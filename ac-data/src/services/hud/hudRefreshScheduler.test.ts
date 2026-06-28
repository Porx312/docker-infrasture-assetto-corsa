import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHudRefreshQueueSizeForTests,
  resetHudRefreshSchedulerForTests,
  scheduleHudRefreshAfterBattleFinished,
  scheduleHudRefreshAfterLap,
} from './hudRefreshScheduler.js';

test('scheduleHudRefreshAfterLap queues board and player without top10', () => {
  resetHudRefreshSchedulerForTests();

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
});

test('scheduleHudRefreshAfterLap ignores incomplete lap payload', () => {
  resetHudRefreshSchedulerForTests();

  scheduleHudRefreshAfterLap({ serverName: 'testing', data: {} });

  const { players, boards } = getHudRefreshQueueSizeForTests();
  assert.equal(players, 0);
  assert.equal(boards, 0);
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
