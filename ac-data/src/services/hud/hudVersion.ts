import {
  buildLbCacheKey,
  buildPlayerCacheKey,
} from './hudCacheKeys.js';
import type { LbCacheParams, PlayerCacheParams } from './hudTypes.js';
import { getHudRedisClient, isHudRedisConfigured } from './hudRedis.js';

export const HUD_VER_PREFIX = 'ac:hud:ver:';
export const HUD_UPDATES_CHANNEL = 'ac:hud:updates';

const HUD_VER_TTL_SEC = Number(process.env.HUD_VER_TTL_SEC || 3600);

export function lbVersionKey(cacheKey: string): string {
  return `${HUD_VER_PREFIX}lb:${cacheKey}`;
}

export function playerVersionKey(cacheKey: string): string {
  return `${HUD_VER_PREFIX}player:${cacheKey}`;
}

export async function bumpLbVersion(params: LbCacheParams): Promise<string> {
  if (!isHudRedisConfigured()) {
    return '';
  }
  const cacheKey = buildLbCacheKey(params);
  return bumpVersionKey(lbVersionKey(cacheKey), cacheKey);
}

export async function bumpPlayerVersion(params: PlayerCacheParams): Promise<string> {
  if (!isHudRedisConfigured()) {
    return '';
  }
  const cacheKey = buildPlayerCacheKey(params);
  return bumpVersionKey(playerVersionKey(cacheKey), cacheKey);
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

export async function readLbVersion(params: LbCacheParams): Promise<string | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const redis = await getHudRedisClient();
  return redis.get(lbVersionKey(buildLbCacheKey(params)));
}

export async function readPlayerVersion(params: PlayerCacheParams): Promise<string | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const redis = await getHudRedisClient();
  return redis.get(playerVersionKey(buildPlayerCacheKey(params)));
}

/** Combined version string for /hud/session clients (lb + each player). */
export function combineSessionVersion(
  lbVersion: string | null,
  playerVersions: Array<string | null>,
): string {
  const parts = [lbVersion ?? '0', ...playerVersions.map((v) => v ?? '0')];
  return parts.join(':');
}
