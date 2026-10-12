import type { IngestBatchResult } from './ingestBatchAck.js';
import { fleetEdgeSecret } from './secrets/fleetSecrets.js';

const backendIngestUrl = (): string =>
  (process.env.BACKEND_INGEST_URL || '').trim().replace(/\/+$/, '');
const instanceId = (): string => (process.env.AC_INSTANCE_ID || 'default').trim();

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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify({
      instanceId: instanceId(),
      events: payloads,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as IngestForwardResponseBody;

  // Hub returns 503 with partial ingestResult on mixed batch failures — keep it so
  // the edge can XACK successes and PEL-retry only failed events.
  return resolveIngestForwardResponse(response.ok, response.status, body, payloads.length);
}
