import type { BoardCacheParams, PlayerCacheParams } from './hudTypes.js';
import { buildBoardCacheKey, buildPlayerCacheKey } from './hudCacheKeys.js';
import {
  boardScopeKeyFromCacheKey,
  playerScopeKeyFromCacheKey,
} from './hudScopeKeys.js';
import { getHudRedisClient, isHudRedisConfigured } from './hudRedis.js';

export const HUD_VER_PREFIX = 'ac:hud:ver:';
export const HUD_UPDATES_CHANNEL = 'ac:hud:updates';

const HUD_VER_TTL_SEC = Number(process.env.HUD_VER_TTL_SEC || 3600);

export function boardVersionKey(cacheKey: string): string {
  return `${HUD_VER_PREFIX}board:${cacheKey}`;
}

export function playerVersionKey(cacheKey: string): string {
  return `${HUD_VER_PREFIX}player:${cacheKey}`;
}

export async function bumpBoardVersion(params: BoardCacheParams): Promise<string> {
  if (!isHudRedisConfigured()) {
    return '';
  }
  const cacheKey = buildBoardCacheKey(params);
  return bumpVersionKey(boardVersionKey(cacheKey), boardScopeKeyFromCacheKey(cacheKey));
}

export async function bumpPlayerVersion(params: PlayerCacheParams): Promise<string> {
  if (!isHudRedisConfigured()) {
    return '';
  }
  const cacheKey = buildPlayerCacheKey(params);
  return bumpVersionKey(playerVersionKey(cacheKey), playerScopeKeyFromCacheKey(cacheKey));
}

async function bumpVersionKey(redisKey: string, scopeKey: string): Promise<string> {
  const version = Date.now().toString();
  const redis = await getHudRedisClient();
  await redis.set(redisKey, version, { EX: HUD_VER_TTL_SEC });
  await redis.publish(
    HUD_UPDATES_CHANNEL,
    JSON.stringify({ scopeKey, version, ts: Date.now() }),
  );
  return version;
}
