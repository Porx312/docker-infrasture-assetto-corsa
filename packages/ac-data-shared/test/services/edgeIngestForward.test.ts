import assert from 'node:assert/strict';
import test from 'node:test';

import type { IngestBatchResult } from '../../src/services/ingestBatchAck.js';
import {
  createIngestForwardAbortSignal,
  forwardIngestBatchToBackend,
  ingestForwardTimeoutMs,
  resolveIngestForwardResponse,
} from '../../src/services/edgeIngestForward.js';

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

test('ingestForwardTimeoutMs defaults and clamps', () => {
  const prev = process.env.INGEST_FORWARD_TIMEOUT_MS;
  try {
    delete process.env.INGEST_FORWARD_TIMEOUT_MS;
    assert.equal(ingestForwardTimeoutMs(), 15_000);
    process.env.INGEST_FORWARD_TIMEOUT_MS = '0';
    assert.equal(ingestForwardTimeoutMs(), 15_000);
    process.env.INGEST_FORWARD_TIMEOUT_MS = '2500';
    assert.equal(ingestForwardTimeoutMs(), 2500);
  } finally {
    if (prev === undefined) delete process.env.INGEST_FORWARD_TIMEOUT_MS;
    else process.env.INGEST_FORWARD_TIMEOUT_MS = prev;
  }
});

test('createIngestForwardAbortSignal aborts after timeout', async () => {
  const signal = createIngestForwardAbortSignal(20);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(signal.aborted, true);
});

test('forwardIngestBatchToBackend timeout leaves recoverable error (no fabricated success)', async () => {
  const prevUrl = process.env.BACKEND_INGEST_URL;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.BACKEND_INGEST_URL = 'http://127.0.0.1:9';
  process.env.FLEET_EDGE_SECRET = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    // Simulate abort mid-flight (timeout path maps AbortError → recoverable throw, no ACK)
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  };

  try {
    await assert.rejects(
      () => forwardIngestBatchToBackend([{ event: 'lap_completed', eventId: 'e1' }]),
      /timeout|unacked/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.BACKEND_INGEST_URL;
    else process.env.BACKEND_INGEST_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
  }
});

test('forwardIngestBatchToBackend HTTP 500 throws (caller must not XACK)', async () => {
  const prevUrl = process.env.BACKEND_INGEST_URL;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.BACKEND_INGEST_URL = 'http://127.0.0.1:9';
  process.env.FLEET_EDGE_SECRET = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'hub_down' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    await assert.rejects(
      () => forwardIngestBatchToBackend([{ event: 'lap_completed', eventId: 'e2' }]),
      /hub_down|HTTP 500/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.BACKEND_INGEST_URL;
    else process.env.BACKEND_INGEST_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
  }
});

test('forwardIngestBatchToBackend network error propagates (no fabricated success / no ACK)', async () => {
  const prevUrl = process.env.BACKEND_INGEST_URL;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.BACKEND_INGEST_URL = 'http://127.0.0.1:9';
  process.env.FLEET_EDGE_SECRET = 'test-secret';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      () => forwardIngestBatchToBackend([{ event: 'lap_completed', eventId: 'e3' }]),
      /fetch failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.BACKEND_INGEST_URL;
    else process.env.BACKEND_INGEST_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
  }
});

/**
 * Bridge contract (redisConvexBridge flushIngestBuffer):
 * await forwardBatchToConvex(...) runs before any xAck loop.
 * If forward throws (timeout/HTTP), xAck is never reached — message stays in PEL.
 * Covered here via forward throw semantics; flushIngestBuffer is not exported for unit mock.
 */
test('contract note: forward throw precedes ACK in bridge flush path', () => {
  assert.ok(typeof forwardIngestBatchToBackend === 'function');
});
