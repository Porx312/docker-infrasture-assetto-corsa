import assert from 'node:assert/strict';
import test from 'node:test';

import type { IngestBatchResult } from './ingestBatchAck.js';
import { resolveIngestForwardResponse } from './edgeIngestForward.js';

test('503 with ingestResult returns partial result (no throw)', () => {
  const partial: IngestBatchResult = {
    ok: false,
    processed: 1,
    failed: 1,
    results: [
      { ok: true, eventType: 'lap_completed', index: 0 },
      { ok: false, eventType: 'lap_completed', index: 1, error: 'boom' },
    ],
  };
  const out = resolveIngestForwardResponse(false, 503, { ok: false, ingestResult: partial }, 2);
  assert.equal(out.failed, 1);
  assert.equal(out.results?.length, 2);
});

test('503 without ingestResult throws', () => {
  assert.throws(
    () => resolveIngestForwardResponse(false, 503, { error: 'convex_down' }, 1),
    /convex_down|HTTP/,
  );
});

test('200 with ingestResult returns it', () => {
  const okResult: IngestBatchResult = {
    ok: true,
    processed: 1,
    failed: 0,
    results: [{ ok: true, eventType: 'lap_completed', index: 0 }],
  };
  const out = resolveIngestForwardResponse(true, 200, { ok: true, ingestResult: okResult }, 1);
  assert.equal(out.ok, true);
  assert.equal(out.processed, 1);
});

test('200 with empty body throws (no fabricated success)', () => {
  assert.throws(() => resolveIngestForwardResponse(true, 200, {}, 3), /missing ingestResult on HTTP 200/);
});

test('200 with ok true but no ingestResult throws', () => {
  assert.throws(
    () => resolveIngestForwardResponse(true, 200, { ok: true }, 2),
    /missing ingestResult on HTTP 200/,
  );
});

test('200 with ingestResult ok true but empty results throws (no fabricated XACK)', () => {
  assert.throws(
    () =>
      resolveIngestForwardResponse(
        true,
        200,
        { ok: true, ingestResult: { ok: true, processed: 2, failed: 0, results: [] } },
        2,
      ),
    /missing per-event results/,
  );
});

test('200 with ingestResult ok true but missing results array throws', () => {
  assert.throws(
    () =>
      resolveIngestForwardResponse(true, 200, { ok: true, ingestResult: { ok: true } }, 1),
    /missing per-event results/,
  );
});
