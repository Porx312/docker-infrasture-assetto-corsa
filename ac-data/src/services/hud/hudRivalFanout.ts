import { isHudConvexConfigured } from './hudConvex.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';
import {
  buildAuthorNameMap,
  observerNeedsConvexRefresh,
  patchObserverRivalPbs,
  type LapAuthorPb,
} from './hudRivalLocalPatch.js';
import { readPlayerPresenceRecord } from './hudPlayerPresence.js';
import {
  getSessionCached,
  invalidateSessionCache,
  refreshPlayerHudCacheForLap,
} from './lapCompletedHudRefresh.js';
import { listConnectedHudSteamIds } from './hudPushHub.js';
import { isHudRedisConfigured } from './hudRedis.js';
import type { PlayerPresenceRecord } from './hudTypes.js';

export type LapBoardContext = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
};

export type { LapAuthorPb };

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
  | ((board: LapBoardContext, lapAuthors: LapAuthorPb[]) => Promise<number>)
  | null = null;

/** Test hook: override fan-out implementation. */
export function setRivalFanoutHandlerForTests(
  handler: ((board: LapBoardContext, lapAuthors: LapAuthorPb[]) => Promise<number>) | null,
): void {
  fanoutHandlerForTests = handler;
}

export async function refreshHudForRivalLapObservers(
  board: LapBoardContext,
  lapAuthors: LapAuthorPb[],
): Promise<number> {
  if (fanoutHandlerForTests) {
    return fanoutHandlerForTests(board, lapAuthors);
  }
  if (!isRivalLapFanoutEnabled()) {
    return 0;
  }
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return 0;
  }

  const authors = lapAuthors.filter(
    (author) =>
      author.steamId.trim().length > 0 &&
      !author.steamId.startsWith('unknown_') &&
      Number.isFinite(author.lapTimeMs) &&
      author.lapTimeMs > 0,
  );
  if (authors.length === 0) {
    return 0;
  }

  const authorIds = new Set(authors.map((author) => author.steamId.trim()));
  const connectedIds = listConnectedHudSteamIds();
  if (connectedIds.length === 0) {
    return 0;
  }

  const { pushHudUpdateForSteamId } = await import('./hudPushHub.js');
  const authorNames = await buildAuthorNameMap(authors);
  let refreshed = 0;
  let localOnly = 0;
  let skipped = 0;

  for (const steamId of connectedIds) {
    const presence = await readPlayerPresenceRecord(steamId);
    if (!shouldFanoutToPlayer(steamId, authorIds, board, presence, true)) {
      continue;
    }

    const session = await getSessionCached({ steamId });
    if (!session.ok || !session.profile) {
      skipped += 1;
      continue;
    }

    if (observerNeedsConvexRefresh(session.profile, authors, authorNames)) {
      await invalidateSessionCache({ steamId });
      await refreshPlayerHudCacheForLap({ steamId, source: 'lap' });
      await pushHudUpdateForSteamId(steamId, false, { pushReason: 'rival_pb' });
      refreshed += 1;
      continue;
    }

    const patched = await patchObserverRivalPbs(steamId, authors, authorNames);
    if (!patched) {
      skipped += 1;
      continue;
    }

    await pushHudUpdateForSteamId(steamId, false, {
      preferCachedSession: true,
      pushReason: 'rival_pb',
    });
    localOnly += 1;
    refreshed += 1;
  }

  if (refreshed > 0 || skipped > 0) {
    console.log(
      `[hud-rival-fanout] board=${board.serverName} refreshed=${refreshed} local=${localOnly} convex=${refreshed - localOnly} skipped=${skipped}`,
    );
  }

  return refreshed;
}
