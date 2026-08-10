import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import { hudRedisDel } from './hudRedis.js';
import type { PlayerCacheParams, SessionQueryParams } from './hudTypes.js';

export async function invalidatePlayerCache(params: PlayerCacheParams): Promise<void> {
  const cacheKey = buildPlayerCacheKey(params);
  await hudRedisDel(playerRedisKey(cacheKey));
}

export async function invalidateSessionCache(params: SessionQueryParams): Promise<void> {
  await hudRedisDel(sessionRedisKey(buildSessionCacheKey(params)));
}

export async function invalidateHudCachesForSteamId(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return;
  }
  const params = { steamId: trimmed };
  await invalidatePlayerCache(params);
  await invalidateSessionCache(params);
}
