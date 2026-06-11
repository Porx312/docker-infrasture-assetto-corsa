import {
  fetchHudPlayer,
  fetchHudSession,
  fetchHudTop10,
  isHudConvexConfigured,
} from './hudConvex.js';
import {
  buildLbCacheKey,
  buildPlayerCacheKey,
  buildSessionCacheKey,
  lbRedisKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import {
  HUD_LB_TTL_SEC,
  HUD_PLAYER_TTL_SEC,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';
import type {
  HudPlayerResult,
  HudSessionResult,
  HudTop10Ok,
} from './hudTypes.js';

async function cacheTop10(
  serverName: string,
  track: string,
  trackConfig: string,
  car: string,
): Promise<void> {
  const params = { serverName, track, trackConfig, car };
  const { cacheKey, top10 } = await fetchHudTop10(params);
  const key = cacheKey || buildLbCacheKey(params);
  await hudRedisSet(lbRedisKey(key), JSON.stringify(top10), HUD_LB_TTL_SEC);
}

async function cachePlayer(
  steamId: string,
  serverName: string,
  track: string,
  trackConfig: string,
  carModel: string,
): Promise<void> {
  const params = { steamId, serverName, track, trackConfig, carModel };
  const result = await fetchHudPlayer(params);
  const key = buildPlayerCacheKey(params);
  await hudRedisSet(playerRedisKey(key), JSON.stringify(result), HUD_PLAYER_TTL_SEC);
}

async function cacheSession(
  steamId: string,
  serverName: string,
  track: string,
  trackConfig: string | undefined,
  carFilter: string | undefined,
  carModel: string | undefined,
): Promise<void> {
  const params = { steamId, serverName, track, trackConfig, carFilter, carModel };
  const result = await fetchHudSession(params);
  const key = buildSessionCacheKey(params);
  await hudRedisSet(sessionRedisKey(key), JSON.stringify(result), HUD_PLAYER_TTL_SEC);
}

export async function refreshHudAfterLapCompleted(payload: Record<string, unknown>): Promise<void> {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const track = typeof data.trackName === 'string' ? data.trackName : '';
  const trackConfig = typeof data.trackConfig === 'string' ? data.trackConfig : '';
  const carModel = typeof data.carModel === 'string' ? data.carModel : '';
  const steamId = typeof data.steamId === 'string' ? data.steamId : '';

  if (!serverName || !track) {
    return;
  }

  try {
    await cacheTop10(serverName, track, trackConfig, 'global');
    if (carModel) {
      await cacheTop10(serverName, track, trackConfig, carModel);
    }
    if (steamId) {
      await cachePlayer(steamId, serverName, track, trackConfig, carModel);
      await cacheSession(steamId, serverName, track, trackConfig, 'global', carModel);
    }
  } catch (err) {
    console.error('[hud-lap-refresh] error:', err);
  }
}

export async function getTop10Cached(params: {
  serverName: string;
  track: string;
  trackConfig?: string;
  car?: string;
}): Promise<HudTop10Ok> {
  const car = params.car ?? 'global';
  const lbParams = { ...params, car };
  const cacheKey = buildLbCacheKey(lbParams);
  const redisKey = lbRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    return JSON.parse(cached) as HudTop10Ok;
  }

  const { cacheKey: resolvedKey, top10 } = await fetchHudTop10(lbParams);
  const key = resolvedKey || cacheKey;
  await hudRedisSet(lbRedisKey(key), JSON.stringify(top10), HUD_LB_TTL_SEC);
  return top10;
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

  const result = await fetchHudPlayer(params);
  await hudRedisSet(redisKey, JSON.stringify(result), HUD_PLAYER_TTL_SEC);
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
  const cacheKey = buildSessionCacheKey(params);
  const redisKey = sessionRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    return JSON.parse(cached) as HudSessionResult;
  }

  const result = await fetchHudSession(params);
  await hudRedisSet(redisKey, JSON.stringify(result), HUD_PLAYER_TTL_SEC);
  return result;
}
