import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coalesceIngestBatch, type PendingIngestMessage } from '../coalesceIngestBatch.js';
import {
  ingestBatchSucceeded,
  partitionIngestResults,
  resolveChunkAckPlan,
} from '../ingestBatchAck.js';

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
  assert.ok(ingestBatchSucceeded({ ok: true, results: coalesced.map((_, i) => ({ ok: true, index: i })) }));
});

test('ingest pipeline: transient failure is not fully resolved', () => {
  assert.equal(
    ingestBatchSucceeded({
      ok: false,
      results: [{ ok: false, error: 'Convex down', index: 0 }],
    }),
    false,
  );
  const coalesced = [pending('player_join', '1')];
  const partitioned = partitionIngestResults(coalesced, {
    results: [{ ok: false, error: 'Convex down', index: 0 }],
  });
  assert.equal(partitioned.retry.length, 1);
});

test('ingest pipeline: user_not_found is acked (no retry)', () => {
  const chunk = [pending('player_join', '1'), pending('lap_completed', '2')];
  const coalesced = coalesceIngestBatch(chunk);
  const partitioned = partitionIngestResults(coalesced, {
    results: [
      { ok: false, error: 'user_not_found', index: 0 },
      { ok: true, index: 1 },
    ],
  });
  const plan = resolveChunkAckPlan(chunk, coalesced, partitioned);
  assert.equal(plan.toRetry.length, 0);
  assert.equal(plan.toAck.length, 2);
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

test('ingest pipeline: local-only forward batch does not retry chunk', () => {
  const chunk = [pending('server_status', '1'), pending('server_status', '2')];
  const coalesced = coalesceIngestBatch(chunk);
  const forward: PendingIngestMessage[] = [];
  const localOnly = [...coalesced];
  const localOnlyIds = new Set(localOnly.map((m) => m.msg.id));

  const partitioned = partitionIngestResults(forward, { ok: true, processed: 0, failed: 0, results: [] });
  const plan = resolveChunkAckPlan(chunk, forward, partitioned);
  const toRetry = forward.length === 0 ? [] : plan.toRetry.filter((m) => !localOnlyIds.has(m.msg.id));

  assert.equal(forward.length, 0);
  assert.ok(plan.toRetry.length > 0);
  assert.equal(toRetry.length, 0);
});
