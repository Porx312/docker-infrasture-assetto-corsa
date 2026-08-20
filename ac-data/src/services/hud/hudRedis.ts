import '../../config/loadEnv.js';
import type { RedisClientType } from 'redis';
import { createRedisClient, isRedisConfigured } from '../redisClient.js';

export const HUD_PLAYER_TTL_SEC = Number(process.env.HUD_PLAYER_TTL_SEC || 300);
export const HUD_SESSION_TTL_SEC = Number(process.env.HUD_SESSION_TTL_SEC || 300);
/** Short negative cache when rival/player is not in Convex live_players (battle enrich loop guard). */
export const HUD_PLAYER_NOT_CONNECTED_TTL_SEC = Number(
  process.env.HUD_PLAYER_NOT_CONNECTED_TTL_SEC || 4,
);
/** Short TTL for transient Convex errors (convex_unreachable is never cached). */
export const HUD_TRANSIENT_ERROR_TTL_SEC = Number(process.env.HUD_TRANSIENT_ERROR_TTL_SEC || 10);
/** Refreshed on server_status, player_join, and successful HUD reads. */
export const HUD_PRESENCE_TTL_SEC = Number(process.env.HUD_PRESENCE_TTL_SEC || 180);
/** Longer TTL on join until player_leave explicitly clears presence. */
export const HUD_PRESENCE_JOIN_TTL_SEC = Number(
  process.env.HUD_PRESENCE_JOIN_TTL_SEC || 600,
);
/** Refreshed on SSE connect and keepalive; telemetry-data uses this for battle matchmaking. */
export const HUD_SSE_PRESENCE_TTL_SEC = Number(process.env.HUD_SSE_PRESENCE_TTL_SEC || 45);

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

export function isHudRedisConfigured(): boolean {
  return isRedisConfigured();
}

export async function getHudRedisClient(): Promise<RedisClientType> {
  if (client?.isOpen) {
    return client;
  }
  if (connectPromise) {
    return connectPromise;
  }

  if (!isRedisConfigured()) {
    throw new Error('REDIS_HOST missing for HUD cache');
  }

  connectPromise = (async () => {
    const redisClient = createRedisClient('hud-redis');
    await redisClient.connect();
    client = redisClient;
    return redisClient;
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

export async function hudRedisGet(key: string): Promise<string | null> {
  const redis = await getHudRedisClient();
  return redis.get(key);
}

export async function hudRedisSet(key: string, value: string, ttlSec: number): Promise<void> {
  const redis = await getHudRedisClient();
  await redis.set(key, value, { EX: ttlSec });
}

export async function hudRedisDel(key: string): Promise<void> {
  const redis = await getHudRedisClient();
  await redis.del(key);
}

/** Extend TTL when key exists; no-op if missing or Redis unavailable. */
export async function hudRedisTouch(key: string, ttlSec: number): Promise<boolean> {
  const redis = await getHudRedisClient();
  const result = await redis.expire(key, ttlSec);
  return result === 1;
}
