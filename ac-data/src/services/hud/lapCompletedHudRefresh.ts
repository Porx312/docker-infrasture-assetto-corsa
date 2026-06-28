import { fetchHudPlayer, fetchHudSession, isHudConvexConfigured } from './hudConvex.js';
import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import { isProfileInvalidated, normalizeHudProfile } from './hudProfile.js';
import {
  HUD_PLAYER_TTL_SEC,
  HUD_SESSION_TTL_SEC,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
} from './hudRedis.js';
import { bumpBoardVersion, bumpPlayerVersion } from './hudVersion.js';
import type { BoardCacheParams, HudPlayerResult, HudSessionResult, PlayerCacheParams, SessionQueryParams } from './hudTypes.js';

function normalizePlayerResult(result: HudPlayerResult): HudPlayerResult {
  if (!result.ok || !result.profile) {
    return result;
  }
  const profile = normalizeHudProfile(result.profile);
  if (!profile) {
    return { ok: true, profile: null };
  }
  return { ok: true, profile };
}

function normalizeSessionResult(result: HudSessionResult): HudSessionResult {
  if (!result.ok || !result.profile) {
    return result;
  }
  const profile = normalizeHudProfile(result.profile);
  if (!profile) {
    return { ...result, profile: null };
  }
  return { ...result, profile };
}

export async function invalidatePlayerCache(params: PlayerCacheParams): Promise<void> {
  const cacheKey = buildPlayerCacheKey(params);
  await hudRedisDel(playerRedisKey(cacheKey));
}

export async function invalidateSessionCache(params: SessionQueryParams): Promise<void> {
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey(params)));
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
  const sessionParams: SessionQueryParams = { steamId: job.steamId };

  await invalidatePlayerCache(job);
  await invalidateSessionCache(sessionParams);

  const [playerResult, sessionResult] = await Promise.all([
    fetchHudPlayer(job),
    fetchHudSession(sessionParams),
  ]);

  const normalizedPlayer = normalizePlayerResult(playerResult);
  const normalizedSession = normalizeSessionResult(sessionResult);

  const cacheKey = buildPlayerCacheKey(job);
  await hudRedisSet(playerRedisKey(cacheKey), JSON.stringify(normalizedPlayer), HUD_PLAYER_TTL_SEC);

  const sessionKey = buildSessionCacheKey(sessionParams);
  await hudRedisSet(sessionRedisKey(sessionKey), JSON.stringify(normalizedSession), HUD_SESSION_TTL_SEC);

  await bumpPlayerVersion(job);
}

export async function getPlayerCached(params: PlayerCacheParams): Promise<HudPlayerResult> {
  const cacheKey = buildPlayerCacheKey(params);
  const redisKey = playerRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = normalizePlayerResult(JSON.parse(cached) as HudPlayerResult);
    if (parsed.ok && isProfileInvalidated(parsed.profile)) {
      return { ok: false, reason: 'user_invalidated' };
    }
    return parsed;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = normalizePlayerResult(await fetchHudPlayer(params));
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }

  await hudRedisSet(redisKey, JSON.stringify(result), HUD_PLAYER_TTL_SEC);
  await bumpPlayerVersion(params);
  return result;
}

export async function getSessionCached(params: SessionQueryParams): Promise<HudSessionResult> {
  const cacheKey = buildSessionCacheKey(params);
  const redisKey = sessionRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = normalizeSessionResult(JSON.parse(cached) as HudSessionResult);
    if (parsed.ok && isProfileInvalidated(parsed.profile)) {
      return { ok: false, reason: 'user_invalidated' };
    }
    return parsed;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = normalizeSessionResult(await fetchHudSession(params));
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }

  await hudRedisSet(redisKey, JSON.stringify(result), HUD_SESSION_TTL_SEC);
  return result;
}
