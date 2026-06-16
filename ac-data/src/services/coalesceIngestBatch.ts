export const WORKER_INGEST_MAX_BATCH_SIZE = 64;
export const WORKER_INGEST_FLUSH_INTERVAL_MS = 5000;

export type PendingIngestMessage = {
  msg: { id: string };
  payload: Record<string, unknown>;
  event: string;
};

/** Keep the latest server_status per serverName; preserve order of other events. */
export function coalesceIngestBatch(messages: PendingIngestMessage[]): PendingIngestMessage[] {
  const out: PendingIngestMessage[] = [];
  const statusSlotByServer = new Map<string, number>();

  for (const message of messages) {
    if (message.event !== 'server_status') {
      out.push(message);
      continue;
    }

    const serverName = typeof message.payload.serverName === 'string' ? message.payload.serverName : '';
    const existingIdx = statusSlotByServer.get(serverName);
    if (existingIdx !== undefined) {
      out[existingIdx] = message;
    } else {
      statusSlotByServer.set(serverName, out.length);
      out.push(message);
    }
  }

  return out;
}

export function shouldFlushIngestBuffer(
  itemCount: number,
  startedAt: number | null,
  now = Date.now(),
  maxBatchSize = WORKER_INGEST_MAX_BATCH_SIZE,
  flushIntervalMs = WORKER_INGEST_FLUSH_INTERVAL_MS,
): boolean {
  if (itemCount === 0) {
    return false;
  }
  if (itemCount >= maxBatchSize) {
    return true;
  }
  if (startedAt !== null && now - startedAt >= flushIntervalMs) {
    return true;
  }
  return false;
}
