import { invalidateHudCachesForSteamId } from '../hud/lapCompletedHudRefresh.js';
import { noteHudPlayerLeave, readHudPlayerPresenceRecord } from '../hud/hudPlayerPresence.js';
import type { EventPayload } from './types.js';

export async function handlePlayerLeaveAfterIngest(payload: EventPayload): Promise<void> {
  const clearedPresence = await noteHudPlayerLeave(payload);

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const steamId = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  if (!steamId || steamId.startsWith('unknown_')) {
    return;
  }

  if (!clearedPresence) {
    return;
  }

  const remainingPresence = await readHudPlayerPresenceRecord(steamId);
  if (remainingPresence) {
    return;
  }

  await invalidateHudCachesForSteamId(steamId);
}
