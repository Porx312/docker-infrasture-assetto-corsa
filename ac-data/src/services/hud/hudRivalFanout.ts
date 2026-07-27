import { isHudConvexConfigured } from './hudConvex.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';
import { readPlayerPresenceRecord } from './hudPlayerPresence.js';
import {
  invalidateSessionCache,
  readCachedSessionFingerprint,
  refreshPlayerHudCacheForLap,
  sessionHudUnchanged,
} from './lapCompletedHudRefresh.js';
import { listConnectedHudSteamIds } from './hudSsePush.js';
import { isHudRedisConfigured } from './hudRedis.js';
import type { PlayerPresenceRecord } from './hudTypes.js';

export type LapBoardContext = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
};

export function isRivalLapFanoutEnabled(): boolean {
  const raw = (process.env.HUD_LAP_RIVAL_FANOUT_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
}

function normalizeCarModel(value: string): string {
  return value.trim().toLowerCase();
}

function presenceMatchesBoard(
  presence: PlayerPresenceRecord,
  board: LapBoardContext,
): boolean {
  const boardServer = normalizeHudServerName(board.serverName).toLowerCase();
  const presenceServer = normalizeHudServerName(presence.serverName).toLowerCase();
  if (boardServer !== presenceServer) {
    return false;
  }
  if (board.track && presence.track !== board.track) {
    return false;
  }
  if (board.trackConfig && presence.trackConfig !== board.trackConfig) {
    return false;
  }
  const boardCar = normalizeCarModel(board.carModel);
  if (boardCar) {
    const presenceCar = normalizeCarModel(presence.carModel);
    if (!presenceCar || presenceCar !== boardCar) {
      return false;
    }
  }
  return true;
}

export function shouldFanoutToPlayer(
  candidateSteamId: string,
  lapAuthorSteamIds: Set<string>,
  board: LapBoardContext,
  presence: PlayerPresenceRecord | null,
  connected: boolean,
): boolean {
  const trimmed = candidateSteamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return false;
  }
  if (!connected) {
    return false;
  }
  if (lapAuthorSteamIds.has(trimmed)) {
    return false;
  }
  if (!presence) {
    return false;
  }
  return presenceMatchesBoard(presence, board);
}

let fanoutHandlerForTests:
  | ((board: LapBoardContext, lapAuthorSteamIds: Iterable<string>) => Promise<number>)
  | null = null;

/** Test hook: override fan-out implementation. */
export function setRivalFanoutHandlerForTests(
  handler:
    | ((board: LapBoardContext, lapAuthorSteamIds: Iterable<string>) => Promise<number>)
    | null,
): void {
  fanoutHandlerForTests = handler;
}

export async function refreshHudForRivalLapObservers(
  board: LapBoardContext,
  lapAuthorSteamIds: Iterable<string>,
): Promise<number> {
  if (fanoutHandlerForTests) {
    return fanoutHandlerForTests(board, lapAuthorSteamIds);
  }
  if (!isRivalLapFanoutEnabled()) {
    return 0;
  }
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return 0;
  }

  const authors = new Set(
    [...lapAuthorSteamIds]
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && !id.startsWith('unknown_')),
  );
  const connectedIds = listConnectedHudSteamIds();
  if (connectedIds.length === 0) {
    return 0;
  }

  const { pushHudUpdateForSteamId } = await import('./hudSsePush.js');
  let refreshed = 0;
  let skipped = 0;

  for (const steamId of connectedIds) {
    const presence = await readPlayerPresenceRecord(steamId);
    if (!shouldFanoutToPlayer(steamId, authors, board, presence, true)) {
      continue;
    }
    const beforeFingerprint = await readCachedSessionFingerprint(steamId);
    await invalidateSessionCache({ steamId });
    await refreshPlayerHudCacheForLap({ steamId, source: 'lap' });
    const afterFingerprint = await readCachedSessionFingerprint(steamId);
    if (sessionHudUnchanged(beforeFingerprint, afterFingerprint)) {
      skipped += 1;
      continue;
    }
    await pushHudUpdateForSteamId(steamId, false, { skipIfSessionUnchanged: true });
    refreshed += 1;
  }

  if (skipped > 0) {
    console.log(`[hud-rival-fanout] board=${board.serverName} refreshed=${refreshed} skipped=${skipped}`);
  }

  return refreshed;
}
