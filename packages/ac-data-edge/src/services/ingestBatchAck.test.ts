import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingIngestMessage } from './coalesceIngestBatch.js';
import {
  ingestBatchSucceeded,
  isNonRetryableIngestError,
  partitionIngestResults,
  resolveChunkAckPlan,
} from './ingestBatchAck.js';

function pending(event: string, id: string, serverName = 'server-a'): PendingIngestMessage {
  return {
    msg: { id },
    event,
    payload: { event, serverName, data: {} },
  };
}

test('isNonRetryableIngestError matches user_not_found', () => {
  assert.equal(isNonRetryableIngestError('user_not_found'), true);
  assert.equal(isNonRetryableIngestError(' USER_NOT_FOUND '), true);
  assert.equal(isNonRetryableIngestError('Convex down'), false);
});

test('partition: all user_not_found is fully done (no retry)', () => {
  const coalesced = [pending('player_join', '1'), pending('lap_completed', '2')];
  const partitioned = partitionIngestResults(coalesced, {
    ok: false,
    results: [
      { ok: false, error: 'user_not_found', index: 0 },
      { ok: false, error: 'user_not_found', index: 1 },
    ],
  });
  assert.deepEqual(partitioned.doneIndices, [0, 1]);
  assert.equal(partitioned.retry.length, 0);
  assert.equal(partitioned.nonRetryableCount, 2);
});

test('partition: mixed success and user_not_found acks both', () => {
  const coalesced = [pending('player_join', '1'), pending('server_status', '2')];
  const partitioned = partitionIngestResults(coalesced, {
    results: [
      { ok: false, error: 'user_not_found', index: 0 },
      { ok: true, index: 1 },
    ],
  });
  assert.deepEqual(partitioned.doneIndices, [0, 1]);
  assert.equal(partitioned.retry.length, 0);
});

test('partition: unknown error is retried', () => {
  const coalesced = [pending('player_join', '1'), pending('player_leave', '2')];
  const partitioned = partitionIngestResults(coalesced, {
    results: [
      { ok: true, index: 0 },
      { ok: false, error: 'Convex down', index: 1 },
    ],
  });
  assert.deepEqual(partitioned.doneIndices, [0]);
  assert.deepEqual(
    partitioned.retry.map((r) => r.msg.id),
    ['2'],
  );
});

test('partition: Convex coalesced battle_update + battle_finished acks both', () => {
  const coalesced = [pending('battle_update', '1'), pending('battle_finished', '2')];
  const partitioned = partitionIngestResults(coalesced, {
    ok: true,
    failed: 0,
    processed: 1,
    coalescedFrom: 2,
    results: [{ ok: true, eventType: 'battle_finished', index: 0 }],
  });
  assert.deepEqual(partitioned.doneIndices, [0, 1]);
  assert.equal(partitioned.retry.length, 0);
  assert.equal(partitioned.unsafeMissingResults, false);
});

test('partition: missing results retries whole batch', () => {
  const coalesced = [pending('player_join', '1')];
  const partitioned = partitionIngestResults(coalesced, { ok: false, failed: 1 });
  assert.equal(partitioned.unsafeMissingResults, true);
  assert.equal(partitioned.retry.length, 1);
});

test('resolveChunkAckPlan acks dropped server_status when kept status is done', () => {
  const chunk = [
    pending('server_status', '1'),
    pending('server_status', '2'),
    pending('player_join', '3'),
  ];
  const coalesced = [pending('server_status', '2'), pending('player_join', '3')];
  const partitioned = partitionIngestResults(coalesced, {
    results: [
      { ok: true, index: 0 },
      { ok: false, error: 'user_not_found', index: 1 },
    ],
  });
  const plan = resolveChunkAckPlan(chunk, coalesced, partitioned);
  assert.deepEqual(
    plan.toAck.map((m) => m.msg.id).sort(),
    ['1', '2', '3'],
  );
  assert.equal(plan.toRetry.length, 0);
});

test('ingestBatchSucceeded still requires all ok', () => {
  assert.equal(
    ingestBatchSucceeded({
      results: [{ ok: false, error: 'user_not_found', index: 0 }],
    }),
    false,
  );
  assert.ok(ingestBatchSucceeded({ ok: true, results: [{ ok: true, index: 0 }] }));
});
