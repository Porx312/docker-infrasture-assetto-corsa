import type { PendingIngestMessage } from './coalesceIngestBatch.js';
import { shouldSkipLapCompletedIngest } from './eventHandlers/lapCompleted.js';
import type { EventPayload } from './eventHandlers/types.js';

export async function partitionCoalescedByIngestPrefs(
  coalesced: PendingIngestMessage[],
  skipLapIngest: (payload: EventPayload) => Promise<boolean> = shouldSkipLapCompletedIngest,
): Promise<{ forward: PendingIngestMessage[]; localOnly: PendingIngestMessage[] }> {
  const forward: PendingIngestMessage[] = [];
  const localOnly: PendingIngestMessage[] = [];
  for (const item of coalesced) {
    if (item.event === 'lap_completed' && (await skipLapIngest(item.payload as EventPayload))) {
      localOnly.push(item);
    } else {
      forward.push(item);
    }
  }
  return { forward, localOnly };
}
