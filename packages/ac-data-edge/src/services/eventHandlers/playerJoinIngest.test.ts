import assert from 'node:assert/strict';
import test from 'node:test';

import { handleEventBeforeIngest } from './index.js';
import { handlePlayerJoinBeforeIngest } from './playerJoin.js';

test('handleEventBeforeIngest routes player_join without throwing', async () => {
  await handleEventBeforeIngest('player_join', {
    event: 'player_join',
    data: { steamId: 'unknown_test_bot', serverName: 'server' },
  });
});

test('handlePlayerJoinBeforeIngest skips unknown_ steam ids', async () => {
  await handlePlayerJoinBeforeIngest({
    event: 'player_join',
    data: { steamId: 'unknown_abc' },
  });
});

test('handleEventBeforeIngest ignores unrelated events', async () => {
  await handleEventBeforeIngest('lap_completed', {
    event: 'lap_completed',
    data: { steamId: '76561199230780195' },
  });
});
