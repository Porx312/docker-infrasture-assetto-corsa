import { fetchHudPlayer, fetchHudSession, isHudConvexConfigured } from './hudConvex.js';
import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import { isProfileInvalidated } from './hudProfile.js';
import {
  HUD_PLAYER_TTL_SEC,
  HUD_SESSION_TTL_SEC,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
} from './hudRedis.js';
import { bumpBoardVersion, bumpPlayerVersion } from './hudVersion.js';
import type { BoardCacheParams, HudPlayerResult, HudSessionResult, PlayerCacheParams } from './hudTypes.js';

export async function invalidatePlayerCache(params: PlayerCacheParams): Promise<void> {
  const cacheKey = buildPlayerCacheKey(params);
  await hudRedisDel(playerRedisKey(cacheKey));
}

export async function invalidateSessionCache(params: {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig?: string;
  carFilter?: string;
  carModel?: string;
}): Promise<void> {
  const cacheKey = buildSessionCacheKey({
    steamId: params.steamId,
    serverName: params.serverName,
    track: params.track,
    trackConfig: params.trackConfig,
    carModel: params.carModel,
    carFilter: params.carFilter ?? 'global',
  });
  await hudRedisDel(sessionRedisKey(cacheKey));
}

export async function bumpBoardVersionsForLap(job: {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
}): Promise<void> {
  const boards: BoardCacheParams[] = [
    { serverName: job.serverName, track: job.track, trackConfig: job.trackConfig, car: 'global' },
  ];
  if (job.carModel) {
    boards.push({
      serverName: job.serverName,
      track: job.track,
      trackConfig: job.trackConfig,
      car: job.carModel,
    });
  }
  await Promise.all(boards.map((params) => bumpBoardVersion(params)));
}

export async function readCachedProfileBestLapMs(params: PlayerCacheParams): Promise<number | null> {
  const cached = await hudRedisGet(playerRedisKey(buildPlayerCacheKey(params)));
  if (!cached) {
    return null;
  }
  try {
    const parsed = JSON.parse(cached) as HudPlayerResult;
    if (parsed.ok && parsed.profile && parsed.profile.best_lap_ms > 0) {
      return parsed.profile.best_lap_ms;
    }
  } catch {
    return null;
  }
  return null;
}

/** True when lapTime beats cached profile best (or cache/profile best is unknown). */
export async function isLapPersonalBest(
  params: PlayerCacheParams,
  lapTimeMs: number,
): Promise<boolean> {
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
    return true;
  }
  const previousBest = await readCachedProfileBestLapMs(params);
  if (previousBest === null) {
    return true;
  }
  return lapTimeMs < previousBest;
}

export async function refreshPlayerHudCache(job: PlayerCacheParams): Promise<void> {
  await invalidatePlayerCache(job);
  const sessionParams = {
    steamId: job.steamId,
    serverName: job.serverName,
    track: job.track,
    trackConfig: job.trackConfig,
    carModel: job.carModel,
    carFilter: 'global' as const,
  };
  await invalidateSessionCache(sessionParams);

  const [playerResult, sessionResult] = await Promise.all([
    fetchHudPlayer(job),
    fetchHudSession(sessionParams),
  ]);

  const cacheKey = buildPlayerCacheKey(job);
  await hudRedisSet(playerRedisKey(cacheKey), JSON.stringify(playerResult), HUD_PLAYER_TTL_SEC);

  const sessionKey = buildSessionCacheKey(sessionParams);
  await hudRedisSet(sessionRedisKey(sessionKey), JSON.stringify(sessionResult), HUD_SESSION_TTL_SEC);

  await bumpPlayerVersion(job);
}

export async function getPlayerCached(params: PlayerCacheParams): Promise<HudPlayerResult> {
  const cacheKey = buildPlayerCacheKey(params);
  const redisKey = playerRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = JSON.parse(cached) as HudPlayerResult;
    if (parsed.ok && isProfileInvalidated(parsed.profile)) {
      return { ok: false, reason: 'user_invalidated' };
    }
    return parsed;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = await fetchHudPlayer(params);
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }

  await hudRedisSet(redisKey, JSON.stringify(result), HUD_PLAYER_TTL_SEC);
  await bumpPlayerVersion(params);
  return result;
}

export async function getSessionCached(params: {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig?: string;
  carFilter?: string;
  carModel?: string;
}): Promise<HudSessionResult> {
  const sessionParams = {
    steamId: params.steamId,
    serverName: params.serverName,
    track: params.track,
    trackConfig: params.trackConfig,
    carFilter: params.carFilter,
    carModel: params.carModel,
  };
  const cacheKey = buildSessionCacheKey({
    ...sessionParams,
    carFilter: params.carFilter ?? 'global',
  });
  const redisKey = sessionRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = JSON.parse(cached) as HudSessionResult;
    if (parsed.ok && isProfileInvalidated(parsed.profile)) {
      return { ok: false, reason: 'user_invalidated' };
    }
    return parsed;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = await fetchHudSession(sessionParams);
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }

  await hudRedisSet(redisKey, JSON.stringify(result), HUD_SESSION_TTL_SEC);
  return result;
}
