import {
  bumpBoardVersionsForLap,
  isLapPersonalBest,
  refreshPlayerHudCache,
} from './lapCompletedHudRefresh.js';
import { isHudConvexConfigured } from './hudConvex.js';
import { isHudRedisConfigured } from './hudRedis.js';

const HUD_LAP_REFRESH_DEBOUNCE_MS = Number(process.env.HUD_LAP_REFRESH_DEBOUNCE_MS || 1500);
const HUD_LAP_REFRESH_DELAY_MS = Number(process.env.HUD_LAP_REFRESH_DELAY_MS || 400);
const HUD_BATTLE_REFRESH_DELAY_MS = Number(process.env.HUD_BATTLE_REFRESH_DELAY_MS || 800);

type PlayerRefreshKey = string;

type PlayerJob = {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
  source: 'lap' | 'battle';
  lapTimeMs?: number;
};

type BoardJob = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
};

function playerJobKey(job: PlayerJob): PlayerRefreshKey {
  return `${job.steamId}|${job.serverName}|${job.track}|${job.trackConfig}|${job.carModel}`;
}

function boardJobKey(job: BoardJob): string {
  return `${job.serverName}|${job.track}|${job.trackConfig}|${job.carModel}`;
}

function isValidSteamId(steamId: string): boolean {
  return steamId.length > 0 && !steamId.startsWith('unknown_');
}

function parseTrackFields(data: Record<string, unknown>): { track: string; trackConfig: string } {
  const track =
    (typeof data.trackName === 'string' && data.trackName) ||
    (typeof data.track === 'string' && data.track) ||
    '';
  const trackConfig = typeof data.trackConfig === 'string' ? data.trackConfig : '';
  return { track, trackConfig };
}

const pendingPlayers = new Map<PlayerRefreshKey, PlayerJob>();
const pendingBoards = new Map<string, BoardJob>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

function queuePlayerJob(job: PlayerJob): void {
  pendingPlayers.set(playerJobKey(job), job);
}

function scheduleFlush(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushHudRefreshQueue();
  }, HUD_LAP_REFRESH_DEBOUNCE_MS);
}

export function scheduleHudRefreshAfterLap(payload: Record<string, unknown>): void {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const { track, trackConfig } = parseTrackFields(data);
  const carModel = typeof data.carModel === 'string' ? data.carModel : '';
  const steamId = typeof data.steamId === 'string' ? data.steamId : '';
  const lapTimeMs = typeof data.lapTime === 'number' ? data.lapTime : Number(data.lapTime);

  if (!serverName || !track) {
    return;
  }

  pendingBoards.set(boardJobKey({ serverName, track, trackConfig, carModel }), {
    serverName,
    track,
    trackConfig,
    carModel,
  });

  if (isValidSteamId(steamId)) {
    queuePlayerJob({
      steamId,
      serverName,
      track,
      trackConfig,
      carModel,
      source: 'lap',
      lapTimeMs: Number.isFinite(lapTimeMs) ? lapTimeMs : undefined,
    });
  }

  scheduleFlush();
}

export function scheduleHudRefreshAfterBattleFinished(payload: Record<string, unknown>): void {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const serverName =
    (typeof payload.serverName === 'string' && payload.serverName) ||
    (typeof data.serverName === 'string' && data.serverName) ||
    '';
  const { track, trackConfig } = parseTrackFields(data);

  if (!serverName || !track) {
    return;
  }

  const player1SteamId =
    typeof data.player1SteamId === 'string' ? data.player1SteamId.trim() : '';
  const player2SteamId =
    typeof data.player2SteamId === 'string' ? data.player2SteamId.trim() : '';
  const player1Car = typeof data.player1Car === 'string' ? data.player1Car : '';
  const player2Car = typeof data.player2Car === 'string' ? data.player2Car : '';

  const entries: Array<{ steamId: string; carModel: string }> = [];
  if (isValidSteamId(player1SteamId)) {
    entries.push({ steamId: player1SteamId, carModel: player1Car });
  }
  if (isValidSteamId(player2SteamId)) {
    entries.push({ steamId: player2SteamId, carModel: player2Car });
  }

  if (entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    queuePlayerJob({
      steamId: entry.steamId,
      serverName,
      track,
      trackConfig,
      carModel: entry.carModel,
      source: 'battle',
    });
  }

  scheduleFlush();
}

async function repushSessionForPlayers(jobs: PlayerJob[]): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  const { playerRoomFromCacheKey } = await import('./hudScopeKeys.js');
  const { pushSessionToPlayerRoom } = await import('./sessionHudPush.js');
  const { buildPlayerCacheKey } = await import('./hudCacheKeys.js');

  await Promise.all(
    jobs.map((job) =>
      Promise.resolve(
        pushSessionToPlayerRoom(
          playerRoomFromCacheKey(
            buildPlayerCacheKey({
              steamId: job.steamId,
              serverName: job.serverName,
              track: job.track,
              trackConfig: job.trackConfig,
              carModel: job.carModel,
            }),
          ),
        ),
      ),
    ),
  );
}

async function repushSessionForBoards(boardJobs: BoardJob[]): Promise<void> {
  if (boardJobs.length === 0) {
    return;
  }

  const { boardRoomFromCacheKey } = await import('./hudScopeKeys.js');
  const { pushSessionToBoardRoom } = await import('./sessionHudPush.js');
  const { buildBoardCacheKey } = await import('./hudCacheKeys.js');

  const rooms = new Set<string>();
  for (const job of boardJobs) {
    rooms.add(
      boardRoomFromCacheKey(
        buildBoardCacheKey({
          serverName: job.serverName,
          track: job.track,
          trackConfig: job.trackConfig,
          car: 'global',
        }),
      ),
    );
    if (job.carModel) {
      rooms.add(
        boardRoomFromCacheKey(
          buildBoardCacheKey({
            serverName: job.serverName,
            track: job.track,
            trackConfig: job.trackConfig,
            car: job.carModel,
          }),
        ),
      );
    }
  }

  for (const room of rooms) {
    pushSessionToBoardRoom(room);
  }
}

async function repushBattleHudForPlayers(jobs: PlayerJob[]): Promise<void> {
  const battleJobs = jobs.filter((job) => job.source === 'battle');
  if (battleJobs.length === 0) {
    return;
  }

  const { pushBattleToRoom } = await import('./battleHudPush.js');
  const { battleRoomFromParams } = await import('./hudBattleRooms.js');

  await Promise.all(
    battleJobs.map((job) => pushBattleToRoom(battleRoomFromParams(job.serverName, job.steamId))),
  );
}

async function flushHudRefreshQueue(): Promise<void> {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    const playerJobs = [...pendingPlayers.values()];
    const boardJobs = [...pendingBoards.values()];
    pendingPlayers.clear();
    pendingBoards.clear();

    if (playerJobs.length === 0 && boardJobs.length === 0) {
      return;
    }

    const hasBattleJobs = playerJobs.some((job) => job.source === 'battle');
    const delayMs = hasBattleJobs ? HUD_BATTLE_REFRESH_DELAY_MS : HUD_LAP_REFRESH_DELAY_MS;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const refreshedPlayers: PlayerJob[] = [];

      await Promise.all(boardJobs.map((job) => bumpBoardVersionsForLap(job)));

      for (const job of playerJobs) {
        if (job.source === 'lap' && job.lapTimeMs !== undefined) {
          const isPb = await isLapPersonalBest(job, job.lapTimeMs);
          if (!isPb) {
            continue;
          }
        }

        await refreshPlayerHudCache(job);
        refreshedPlayers.push(job);
      }

      await repushBattleHudForPlayers(refreshedPlayers);
      await repushSessionForPlayers(refreshedPlayers);
      await repushSessionForBoards(boardJobs);

      console.log(
        `[hud-refresh] boards=${boardJobs.length} players=${refreshedPlayers.length}/${playerJobs.length}`,
      );
    } catch (err) {
      console.error('[hud-refresh] flush error:', err);
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

/** Test helper: reset scheduler state. */
export function resetHudRefreshSchedulerForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingPlayers.clear();
  pendingBoards.clear();
  flushPromise = null;
}

/** Test helper: pending job counts after scheduling. */
export function getHudRefreshQueueSizeForTests(): { players: number; boards: number } {
  return { players: pendingPlayers.size, boards: pendingBoards.size };
}
