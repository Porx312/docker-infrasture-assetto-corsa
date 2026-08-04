import { scheduleHudRefreshAfterLap } from '../hud/hudRefreshScheduler.js';
import {
  invalidateHudCachesForSteamId,
  isLapPersonalBest,
  patchLastLapInCaches,
} from '../hud/lapCompletedHudRefresh.js';
import { pushHudUpdateForSteamId } from '../hud/hudSsePush.js';
import type { EventPayload } from './types.js';

export async function handleLapCompletedAfterIngest(payload: EventPayload): Promise<void> {
  const lapData = (payload.data ?? {}) as Record<string, unknown>;
  const lapSteamId = typeof lapData.steamId === 'string' ? lapData.steamId.trim() : '';
  const lapTimeMs =
    typeof lapData.lapTime === 'number' ? lapData.lapTime : Number(lapData.lapTime);

  if (lapSteamId) {
    const isPersonalBest = Number.isFinite(lapTimeMs)
      ? await isLapPersonalBest({ steamId: lapSteamId }, lapTimeMs)
      : true;
    if (Number.isFinite(lapTimeMs) && lapTimeMs > 0) {
      const patched = await patchLastLapInCaches({ steamId: lapSteamId }, lapTimeMs);
      if (patched) {
        void pushHudUpdateForSteamId(lapSteamId, false, { preferCachedSession: true });
      }
    }
    if (isPersonalBest) {
      await invalidateHudCachesForSteamId(lapSteamId);
    }
    scheduleHudRefreshAfterLap({
      ...payload,
      data: { ...lapData, isPersonalBest },
    });
  } else {
    scheduleHudRefreshAfterLap(payload);
  }
}
