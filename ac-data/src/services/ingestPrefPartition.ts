import type { PendingIngestMessage } from './coalesceIngestBatch.js';
import { shouldSkipLapCompletedIngest } from './eventHandlers/lapCompleted.js';
import type { EventPayload } from './eventHandlers/types.js';

export const INGEST_SKIP_EMPTY_SERVER_STATUS =
  (process.env.INGEST_SKIP_EMPTY_SERVER_STATUS ?? 'true').trim().toLowerCase() === 'true';

export function isEmptyServerStatusPayload(payload: Record<string, unknown>): boolean {
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    return true;
  }
  const players = (data as Record<string, unknown>).players;
  return !Array.isArray(players) || players.length === 0;
}

export function shouldSkipServerStatusConvexIngest(
  event: string,
  payload: Record<string, unknown>,
  skipEmpty = INGEST_SKIP_EMPTY_SERVER_STATUS,
): boolean {
  return event === 'server_status' && skipEmpty && isEmptyServerStatusPayload(payload);
}

export async function partitionCoalescedByIngestPrefs(
  coalesced: PendingIngestMessage[],
  skipLapIngest: (payload: EventPayload) => Promise<boolean> = shouldSkipLapCompletedIngest,
  skipEmptyServerStatus = INGEST_SKIP_EMPTY_SERVER_STATUS,
): Promise<{ forward: PendingIngestMessage[]; localOnly: PendingIngestMessage[] }> {
  const forward: PendingIngestMessage[] = [];
  const localOnly: PendingIngestMessage[] = [];
  for (const item of coalesced) {
    if (item.event === 'lap_completed' && (await skipLapIngest(item.payload as EventPayload))) {
      localOnly.push(item);
    } else if (
      shouldSkipServerStatusConvexIngest(item.event, item.payload, skipEmptyServerStatus)
    ) {
      localOnly.push(item);
    } else {
      forward.push(item);
    }
  }
  return { forward, localOnly };
}
