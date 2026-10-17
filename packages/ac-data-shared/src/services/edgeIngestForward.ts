import type { IngestBatchResult } from './ingestBatchAck.js';
import { fleetEdgeSecret } from './secrets/fleetSecrets.js';

const backendIngestUrl = (): string =>
  (process.env.BACKEND_INGEST_URL || '').trim().replace(/\/+$/, '');
const instanceId = (): string => (process.env.AC_INSTANCE_ID || 'default').trim();

/** Default 15s. Repo requires Node 20+ (AbortSignal.timeout). */
export function ingestForwardTimeoutMs(): number {
  const raw = Number(process.env.INGEST_FORWARD_TIMEOUT_MS || 15_000);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return Math.trunc(raw);
}

/**
 * AbortSignal for ingest forward. Node 20+ uses AbortSignal.timeout;
 * polyfill keeps older runtimes from hanging forever.
 */
export function createIngestForwardAbortSignal(timeoutMs: number = ingestForwardTimeoutMs()): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref();
  }
  return controller.signal;
}

export function isBackendIngestForwardConfigured(): boolean {
  return backendIngestUrl().length > 0;
}

export type IngestForwardResponseBody = {
  ok?: boolean;
  ingestResult?: IngestBatchResult;
  error?: string;
};

function isPlainIngestResult(value: unknown): value is IngestBatchResult {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse hub /worker/ingest-events response.
 * HTTP success without a valid ingestResult (including per-event results when
 * payloads were sent) must throw so the edge does not XACK.
 */
export function resolveIngestForwardResponse(
  responseOk: boolean,
  status: number,
  body: IngestForwardResponseBody,
  payloadsLength: number,
): IngestBatchResult {
  if (isPlainIngestResult(body.ingestResult)) {
    if (payloadsLength > 0) {
      const results = body.ingestResult.results;
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error(`ingestResult missing per-event results on HTTP ${status}`);
      }
    }
    return body.ingestResult;
  }
  if (!responseOk) {
    throw new Error(body.error || `backend ingest HTTP ${status}`);
  }
  throw new Error(`missing ingestResult on HTTP ${status}`);
}

/**
 * Forward a batch to hub. On timeout/network/HTTP failure throws so the Redis
 * bridge keeps messages unacked for PEL reclaim — never treat hang as success.
 *
 * No HTTP retries here: the bridge/PEL already retry. Retrying fetch would
 * increase duplicate risk when Convex accepted but the response was lost.
 *
 * Duplicate window (documented): Convex/hub may have accepted events while
 * edge never got ingestResult → at-least-once; destination must dedupe by eventId.
 */
export async function forwardIngestBatchToBackend(
  payloads: Record<string, unknown>[],
): Promise<IngestBatchResult> {
  const baseUrl = backendIngestUrl();
  const secret = fleetEdgeSecret();
  if (!baseUrl) {
    throw new Error('BACKEND_INGEST_URL missing for edge ingest forward');
  }
  if (!secret) {
    throw new Error('FLEET_EDGE_SECRET or CONVEX_WORKER_SECRET missing for edge ingest forward');
  }
  if (payloads.length === 0) {
    return { ok: true, processed: 0, failed: 0, results: [] };
  }

  const url = `${baseUrl}/worker/ingest-events`;
  const signal = createIngestForwardAbortSignal();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': secret,
      },
      body: JSON.stringify({
        instanceId: instanceId(),
        events: payloads,
      }),
      signal,
    });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error(
        `backend ingest timeout after ${ingestForwardTimeoutMs()}ms (message left unacked for PEL reclaim)`,
      );
    }
    throw err;
  }

  const body = (await response.json().catch(() => ({}))) as IngestForwardResponseBody;

  // Hub returns 503 with partial ingestResult on mixed batch failures — keep it so
  // the edge can XACK successes and PEL-retry only failed events.
  return resolveIngestForwardResponse(response.ok, response.status, body, payloads.length);
}
