import {
  fetchHudPlayer,
  fetchHudTop10,
  isHudConvexConfigured,
  queryHudTop10,
  resolveTop10CacheKey,
} from './hudConvex.js';
import {
  buildLbCacheKey,
  buildPlayerCacheKey,
  lbRedisKey,
  playerRedisKey,
} from './hudCacheKeys.js';
import {
  HUD_LB_TTL_SEC,
  HUD_PLAYER_TTL_SEC,
  hudRedisGet,
  hudRedisSet,
} from './hudRedis.js';
import { bumpLbVersion, bumpPlayerVersion } from './hudVersion.js';
import type { HudPlayerResult, HudTop10, HudTop10Ok } from './hudTypes.js';

let lastHudCacheRefreshAt = 0;

export function noteHudCacheRefreshed(): void {
  lastHudCacheRefreshAt = Date.now();
}

/** Skip expensive Convex version poll when lap-driven refresh ran recently. */
export function wasHudCacheRefreshedRecently(withinMs = 60_000): boolean {
  return lastHudCacheRefreshAt > 0 && Date.now() - lastHudCacheRefreshAt < withinMs;
}

export async function cacheTop10ForLap(job: {
  serverName: string;
  track: string;
  trackConfig: string;
  car: string;
}): Promise<void> {
  const params = {
    serverName: job.serverName,
    track: job.track,
    trackConfig: job.trackConfig,
    car: job.car,
  };
  const { cacheKey, top10 } = await fetchHudTop10(params);
  const key = cacheKey || buildLbCacheKey(params);
  await hudRedisSet(lbRedisKey(key), JSON.stringify(top10), HUD_LB_TTL_SEC);
  await bumpLbVersion(params);
}

export async function cachePlayerForLap(job: {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
}): Promise<void> {
  const params = {
    steamId: job.steamId,
    serverName: job.serverName,
    track: job.track,
    trackConfig: job.trackConfig,
    carModel: job.carModel,
  };
  const result = await fetchHudPlayer(params);
  const key = buildPlayerCacheKey(params);
  await hudRedisSet(playerRedisKey(key), JSON.stringify(result), HUD_PLAYER_TTL_SEC);
  await bumpPlayerVersion(params);
}

/** @deprecated Use scheduleHudRefreshAfterLap from hudRefreshScheduler instead. */
export async function refreshHudAfterLapCompleted(payload: Record<string, unknown>): Promise<void> {
  const { scheduleHudRefreshAfterLap } = await import('./hudRefreshScheduler.js');
  scheduleHudRefreshAfterLap(payload);
}

export async function getTop10Cached(params: {
  serverName: string;
  track: string;
  trackConfig?: string;
  car?: string;
}): Promise<HudTop10> {
  const car = params.car ?? 'global';
  const lbParams = { ...params, car };
  const cacheKey = buildLbCacheKey(lbParams);
  const redisKey = lbRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    return JSON.parse(cached) as HudTop10Ok;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'no_data' };
  }

  const result = await queryHudTop10(lbParams);
  if (!result.ok) {
    return result;
  }

  const key = resolveTop10CacheKey(lbParams, result);
  await hudRedisSet(lbRedisKey(key), JSON.stringify(result), HUD_LB_TTL_SEC);
  await bumpLbVersion(lbParams);
  return result;
}

export async function getPlayerCached(params: {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig?: string;
  carModel?: string;
}): Promise<HudPlayerResult> {
  const cacheKey = buildPlayerCacheKey(params);
  const redisKey = playerRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    return JSON.parse(cached) as HudPlayerResult;
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = await fetchHudPlayer(params);
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
}): Promise<HudPlayerResult> {
  return getPlayerCached({
    steamId: params.steamId,
    serverName: params.serverName,
    track: params.track,
    trackConfig: params.trackConfig,
    carModel: params.carModel,
  });
}
