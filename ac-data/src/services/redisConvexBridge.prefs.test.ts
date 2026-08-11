import assert from 'node:assert/strict';
import test from 'node:test';

import type { PendingIngestMessage } from './coalesceIngestBatch.js';
import { partitionCoalescedByIngestPrefs } from './ingestPrefPartition.js';

function lapPending(id: string, steamId: string): PendingIngestMessage {
  return {
    msg: { id },
    event: 'lap_completed',
    payload: {
      event: 'lap_completed',
      serverName: 'server',
      data: { steamId, lapTime: 95_000 },
    },
  };
}

function playerJoinPending(id: string): PendingIngestMessage {
  return {
    msg: { id },
    event: 'player_join',
    payload: { event: 'player_join', serverName: 'server', data: { steamId: 'steam-a' } },
  };
}

test('partitionCoalescedByIngestPrefs routes lap_completed to localOnly when saveTime=false', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [lapPending('1', 'steam-a')],
    async () => true,
  );

  assert.equal(forward.length, 0);
  assert.equal(localOnly.length, 1);
  assert.equal(localOnly[0]?.msg.id, '1');
});

test('partitionCoalescedByIngestPrefs forwards lap_completed when saveTime=true', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [lapPending('1', 'steam-a')],
    async () => false,
  );

  assert.equal(forward.length, 1);
  assert.equal(localOnly.length, 0);
  assert.equal(forward[0]?.msg.id, '1');
});

test('partitionCoalescedByIngestPrefs always forwards non-lap events', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [playerJoinPending('2'), lapPending('1', 'steam-a')],
    async () => true,
  );

  assert.equal(forward.length, 1);
  assert.equal(forward[0]?.event, 'player_join');
  assert.equal(localOnly.length, 1);
  assert.equal(localOnly[0]?.event, 'lap_completed');
});

function emptyServerStatusPending(id: string): PendingIngestMessage {
  return {
    msg: { id },
    event: 'server_status',
    payload: {
      event: 'server_status',
      serverName: 'server',
      data: { players: [], trackName: 'ks_nordschleife', trackConfig: 'touristenfahrten' },
    },
  };
}

function populatedServerStatusPending(id: string): PendingIngestMessage {
  return {
    msg: { id },
    event: 'server_status',
    payload: {
      event: 'server_status',
      serverName: 'server',
      data: {
        players: [{ steamId: 'steam-a', name: 'A', carModel: 'ks_toyota_gt86' }],
        trackName: 'ks_nordschleife',
      },
    },
  };
}

test('partitionCoalescedByIngestPrefs routes empty server_status to localOnly when skip enabled', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [emptyServerStatusPending('3')],
    async () => false,
    true,
  );

  assert.equal(forward.length, 0);
  assert.equal(localOnly.length, 1);
  assert.equal(localOnly[0]?.event, 'server_status');
});

test('partitionCoalescedByIngestPrefs forwards populated server_status when skip enabled', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [populatedServerStatusPending('4')],
    async () => false,
    true,
  );

  assert.equal(forward.length, 1);
  assert.equal(localOnly.length, 0);
});

test('partitionCoalescedByIngestPrefs forwards empty server_status when skip disabled', async () => {
  const { forward, localOnly } = await partitionCoalescedByIngestPrefs(
    [emptyServerStatusPending('5')],
    async () => false,
    false,
  );

  assert.equal(forward.length, 1);
  assert.equal(localOnly.length, 0);
});
