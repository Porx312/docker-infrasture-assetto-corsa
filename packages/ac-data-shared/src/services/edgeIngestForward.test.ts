import assert from 'node:assert/strict';
import test from 'node:test';

import type { IngestBatchResult } from './ingestBatchAck.js';

/**
 * Mirrors forwardIngestBatchToBackend response handling for unit tests
 * (avoids loading dotenv / env requirements).
 */
export function resolveIngestForwardBody(
  responseOk: boolean,
  body: { ok?: boolean; ingestResult?: IngestBatchResult; error?: string },
  payloadsLength: number,
): IngestBatchResult {
  if (body.ingestResult && typeof body.ingestResult === 'object') {
    return body.ingestResult;
  }
  if (!responseOk) {
    throw new Error(body.error || `backend ingest HTTP failed`);
  }
  return {
    ok: body.ok !== false,
    processed: payloadsLength,
    failed: body.ok === false ? payloadsLength : 0,
    results: [],
  };
}

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
  const out = resolveIngestForwardBody(false, { ok: false, ingestResult: partial }, 2);
  assert.equal(out.failed, 1);
  assert.equal(out.results?.length, 2);
});

test('503 without ingestResult throws', () => {
  assert.throws(
    () => resolveIngestForwardBody(false, { error: 'convex_down' }, 1),
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
  const out = resolveIngestForwardBody(true, { ok: true, ingestResult: okResult }, 1);
  assert.equal(out.ok, true);
  assert.equal(out.processed, 1);
});
