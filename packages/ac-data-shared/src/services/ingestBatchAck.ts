import type { PendingIngestMessage } from './coalesceIngestBatch.js';

export const NON_RETRYABLE_INGEST_ERRORS = new Set(['user_not_found']);

export type IngestEventResult = {
  ok?: boolean;
  error?: string;
  eventType?: string;
  index?: number;
};

export type IngestBatchResult = {
  ok?: boolean;
  failed?: number;
  processed?: number;
  /** Convex may merge multiple worker events (e.g. battle_update + battle_finished). */
  coalescedFrom?: number;
  results?: IngestEventResult[];
};

export type PartitionedIngest = {
  /** Coalesced indices that can be acked (success or non-retryable). */
  doneIndices: number[];
  /** Coalesced messages that must be retried. */
  retry: PendingIngestMessage[];
  /** Count of events dropped as non-retryable (e.g. user_not_found). */
  nonRetryableCount: number;
  /** True when Convex omitted usable per-event results — retry whole batch. */
  unsafeMissingResults: boolean;
};

export function normalizeIngestError(error: unknown): string {
  if (typeof error !== 'string') {
    return '';
  }
  return error.trim().toLowerCase();
}

export function isNonRetryableIngestError(error: unknown): boolean {
  const normalized = normalizeIngestError(error);
  return normalized.length > 0 && NON_RETRYABLE_INGEST_ERRORS.has(normalized);
}

/** True when every event in the batch succeeded (or the batch is empty). */
export function ingestBatchSucceeded(result: IngestBatchResult): boolean {
  const results = result.results ?? [];
  if (results.length === 0) {
    return result.ok !== false && (result.failed ?? 0) === 0;
  }
  return results.every((r) => r.ok === true);
}

/**
 * Partition coalesced events by Convex per-event results.
 * Missing/unindexed results → unsafe (retry entire coalesced batch).
 */
export function partitionIngestResults(
  coalesced: PendingIngestMessage[],
  result: IngestBatchResult,
): PartitionedIngest {
  const results = result.results ?? [];
  if (coalesced.length === 0) {
    return { doneIndices: [], retry: [], nonRetryableCount: 0, unsafeMissingResults: false };
  }

  if (results.length === 0) {
    // No per-event detail: only treat as done when the batch itself succeeded.
    if (ingestBatchSucceeded(result)) {
      return {
        doneIndices: coalesced.map((_, i) => i),
        retry: [],
        nonRetryableCount: 0,
        unsafeMissingResults: false,
      };
    }
    return {
      doneIndices: [],
      retry: [...coalesced],
      nonRetryableCount: 0,
      unsafeMissingResults: true,
    };
  }

  // Convex coalesced multiple events into fewer rows (e.g. battle_update +
  // battle_finished → one battle_finished result at index 0). Trust batch-level
  // success so we XACK all source events and run after-ingest hooks.
  if (
    result.ok === true &&
    (result.failed ?? 0) === 0 &&
    results.length < coalesced.length &&
    results.every((row) => row.ok === true)
  ) {
    return {
      doneIndices: coalesced.map((_, i) => i),
      retry: [],
      nonRetryableCount: 0,
      unsafeMissingResults: false,
    };
  }

  const byIndex = new Map<number, IngestEventResult>();
  for (const row of results) {
    if (typeof row.index === 'number' && Number.isInteger(row.index) && row.index >= 0) {
      byIndex.set(row.index, row);
    }
  }

  // Prefer indexed results; fall back to positional if every row lacks index
  // and lengths match.
  const usePositional = byIndex.size === 0 && results.length === coalesced.length;

  const doneIndices: number[] = [];
  const retry: PendingIngestMessage[] = [];
  let nonRetryableCount = 0;

  for (let i = 0; i < coalesced.length; i++) {
    const row = usePositional ? results[i] : byIndex.get(i);
    if (!row) {
      // Missing result for this index — retry safely.
      retry.push(coalesced[i]!);
      continue;
    }
    if (row.ok === true) {
      doneIndices.push(i);
      continue;
    }
    if (isNonRetryableIngestError(row.error)) {
      doneIndices.push(i);
      nonRetryableCount += 1;
      continue;
    }
    retry.push(coalesced[i]!);
  }

  return {
    doneIndices,
    retry,
    nonRetryableCount,
    unsafeMissingResults: false,
  };
}

/**
 * Map coalesced done/retry onto the original chunk (including dropped
 * duplicate server_status messages that should be acked with the kept one).
 */
export function resolveChunkAckPlan(
  chunk: PendingIngestMessage[],
  coalesced: PendingIngestMessage[],
  partitioned: PartitionedIngest,
): { toAck: PendingIngestMessage[]; toRetry: PendingIngestMessage[] } {
  if (partitioned.unsafeMissingResults) {
    return { toAck: [], toRetry: [...chunk] };
  }

  const doneCoalesced = new Set(partitioned.doneIndices.map((i) => coalesced[i]!));
  const doneIds = new Set([...doneCoalesced].map((m) => m.msg.id));
  const retryIds = new Set(partitioned.retry.map((m) => m.msg.id));
  const coalescedIds = new Set(coalesced.map((m) => m.msg.id));

  // serverName → kept (latest) server_status message after coalesce
  const keptStatusByServer = new Map<string, PendingIngestMessage>();
  for (const item of coalesced) {
    if (item.event !== 'server_status') continue;
    const serverName =
      typeof item.payload.serverName === 'string' ? item.payload.serverName : '';
    keptStatusByServer.set(serverName, item);
  }

  const toAck: PendingIngestMessage[] = [];
  const toRetry: PendingIngestMessage[] = [];

  for (const item of chunk) {
    if (doneIds.has(item.msg.id)) {
      toAck.push(item);
      continue;
    }
    if (retryIds.has(item.msg.id)) {
      toRetry.push(item);
      continue;
    }
    // Dropped duplicate server_status (not in coalesced): ack if kept status is done.
    if (item.event === 'server_status' && !coalescedIds.has(item.msg.id)) {
      const serverName =
        typeof item.payload.serverName === 'string' ? item.payload.serverName : '';
      const kept = keptStatusByServer.get(serverName);
      if (kept && doneIds.has(kept.msg.id)) {
        toAck.push(item);
      } else if (kept && retryIds.has(kept.msg.id)) {
        toRetry.push(item);
      } else {
        toRetry.push(item);
      }
      continue;
    }
    // Unknown — retry safely
    toRetry.push(item);
  }

  return { toAck, toRetry };
}
