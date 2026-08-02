import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coalesceIngestBatch, type PendingIngestMessage } from '../coalesceIngestBatch.js';
import { ingestBatchSucceeded } from '../redisConvexBridge.js';

function pending(event: string, id: string, serverName = 'server-a'): PendingIngestMessage {
  return {
    msg: { id },
    event,
    payload: { event, serverName, data: {} },
  };
}

test('ingest pipeline: coalesce then succeed acks batch', () => {
  const chunk = [
    pending('server_status', '1'),
    pending('lap_completed', '2'),
    pending('server_status', '3'),
    pending('player_join', '4'),
  ];

  const coalesced = coalesceIngestBatch(chunk);
  assert.equal(coalesced.length, 3);
  assert.ok(ingestBatchSucceeded({ ok: true, results: coalesced.map(() => ({ ok: true })) }));
});

test('ingest pipeline: failed batch is not acked', () => {
  assert.equal(
    ingestBatchSucceeded({
      ok: false,
      results: [{ ok: false, error: 'Convex down' }],
    }),
    false,
  );
});

test('ingest pipeline: coalesce drops duplicate server_status before forward', () => {
  const chunk = [
    pending('server_status', '1'),
    pending('server_status', '2'),
    pending('player_leave', '3'),
  ];
  const coalesced = coalesceIngestBatch(chunk);
  assert.deepEqual(
    coalesced.map((c) => c.msg.id),
    ['2', '3'],
  );
});
