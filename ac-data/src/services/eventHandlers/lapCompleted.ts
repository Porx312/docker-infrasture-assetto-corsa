import { scheduleHudRefreshAfterLap } from '../hud/hudRefreshScheduler.js';
import { readSaveTimeEnabled } from '../hud/hudUserPrefs.js';
import {
  invalidateHudCachesForSteamId,
  isLapPersonalBest,
  patchLastLapInCaches,
} from '../hud/lapCompletedHudRefresh.js';
import { pushHudUpdateForSteamId } from '../hud/hudSsePush.js';
import type { EventPayload } from './types.js';

function lapSteamIdFromPayload(payload: EventPayload): string {
  const lapData = (payload.data ?? {}) as Record<string, unknown>;
  return typeof lapData.steamId === 'string' ? lapData.steamId.trim() : '';
}

type SaveTimeReader = (steamId: string) => Promise<boolean>;

let saveTimeReaderForTests: SaveTimeReader | null = null;

/** Override Redis readSaveTimeEnabled in unit tests (no Redis required). */
export function setSaveTimeReaderForTests(reader: SaveTimeReader | null): void {
  saveTimeReaderForTests = reader;
}

/** Skip Convex ingest when user opted out of saving lap times (HUD still updated locally). */
export async function shouldSkipLapCompletedIngest(payload: EventPayload): Promise<boolean> {
  const steamId = lapSteamIdFromPayload(payload);
  if (!steamId) {
    return false;
  }
  const enabled = saveTimeReaderForTests
    ? await saveTimeReaderForTests(steamId)
    : await readSaveTimeEnabled(steamId);
  return !enabled;
}

export async function handleLapCompletedAfterIngest(payload: EventPayload): Promise<void> {
  const lapData = (payload.data ?? {}) as Record<string, unknown>;
  const lapSteamId = lapSteamIdFromPayload(payload);
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
