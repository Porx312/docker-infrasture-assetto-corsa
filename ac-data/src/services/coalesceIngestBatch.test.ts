import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coalesceIngestBatch,
  shouldFlushIngestBuffer,
  WORKER_INGEST_FLUSH_INTERVAL_MS,
  WORKER_INGEST_MAX_BATCH_SIZE,
  type PendingIngestMessage,
} from './coalesceIngestBatch.js';

function msg(event: string, serverName: string, id: string): PendingIngestMessage {
  return {
    msg: { id },
    event,
    payload: { serverName, event },
  };
}

test('coalesceIngestBatch keeps only latest server_status per server', () => {
  const input = [
    msg('server_status', 'server-a', '1'),
    msg('lap_completed', 'server-a', '2'),
    msg('server_status', 'server-a', '3'),
    msg('server_status', 'server-b', '4'),
    msg('server_status', 'server-b', '5'),
  ];

  const out = coalesceIngestBatch(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].msg.id, '3');
  assert.equal(out[1].msg.id, '2');
  assert.equal(out[2].msg.id, '5');
});

test('coalesceIngestBatch leaves non-status events untouched', () => {
  const input = [
    msg('player_join', 'server-a', '1'),
    msg('player_leave', 'server-a', '2'),
    msg('battle_finished', 'server-a', '3'),
  ];
  assert.deepEqual(coalesceIngestBatch(input), input);
});

test('shouldFlushIngestBuffer flushes at max batch size', () => {
  assert.equal(shouldFlushIngestBuffer(WORKER_INGEST_MAX_BATCH_SIZE, null), true);
});

test('shouldFlushIngestBuffer flushes after interval', () => {
  const now = 10_000;
  const startedAt = now - WORKER_INGEST_FLUSH_INTERVAL_MS;
  assert.equal(shouldFlushIngestBuffer(3, startedAt, now), true);
});

test('shouldFlushIngestBuffer waits before interval', () => {
  const now = 10_000;
  const startedAt = now - (WORKER_INGEST_FLUSH_INTERVAL_MS - 1);
  assert.equal(shouldFlushIngestBuffer(3, startedAt, now), false);
});
