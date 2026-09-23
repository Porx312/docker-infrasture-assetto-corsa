import type { IngestBatchResult } from './ingestBatchAck.js';

const backendIngestUrl = (): string =>
  (process.env.BACKEND_INGEST_URL || '').trim().replace(/\/+$/, '');
const workerSecret = (): string => (process.env.CONVEX_WORKER_SECRET || '').trim();
const instanceId = (): string => (process.env.AC_INSTANCE_ID || 'default').trim();

export function isBackendIngestForwardConfigured(): boolean {
  return backendIngestUrl().length > 0;
}

export async function forwardIngestBatchToBackend(
  payloads: Record<string, unknown>[],
): Promise<IngestBatchResult> {
  const baseUrl = backendIngestUrl();
  const secret = workerSecret();
  if (!baseUrl) {
    throw new Error('BACKEND_INGEST_URL missing for edge ingest forward');
  }
  if (!secret) {
    throw new Error('CONVEX_WORKER_SECRET missing for edge ingest forward');
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
      workerSecret: secret,
      instanceId: instanceId(),
      events: payloads,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    ingestResult?: IngestBatchResult;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(body.error || `backend ingest HTTP ${response.status}`);
  }

  if (body.ingestResult && typeof body.ingestResult === 'object') {
    return body.ingestResult;
  }

  return {
    ok: body.ok !== false,
    processed: payloads.length,
    failed: body.ok === false ? payloads.length : 0,
    results: [],
  };
}
