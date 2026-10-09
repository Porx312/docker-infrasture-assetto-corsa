import { ensureConvexClient } from './convexClient.js';
import { buildIngestEvent } from './ingestEventBuilder.js';
import type { IngestBatchResult } from './ingestBatchAck.js';

const CONVEX_MUTATION_BATCH =
  process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
const CONVEX_INGEST_SECRET = (): string => (process.env.CONVEX_INGEST_SECRET || '').trim();

function parseIngestBatchResult(raw: unknown): IngestBatchResult {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw as IngestBatchResult;
}

export async function submitPayloadsToConvexIngest(
  payloads: Record<string, unknown>[],
): Promise<IngestBatchResult> {
  const secret = CONVEX_INGEST_SECRET();
  if (!secret) {
    throw new Error('CONVEX_INGEST_SECRET missing');
  }
  if (payloads.length === 0) {
    return { ok: true, processed: 0, failed: 0, results: [] };
  }

  const { mutation } = ensureConvexClient();
  const raw = await mutation(CONVEX_MUTATION_BATCH, {
    ingestSecret: secret,
    events: payloads.map((payload) => buildIngestEvent(payload)),
  });
  return parseIngestBatchResult(raw);
}
