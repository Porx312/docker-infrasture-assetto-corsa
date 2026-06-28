import '../../config/loadEnv.js';
import { createClient, type RedisClientType } from 'redis';

const REDIS_HOST = process.env.REDIS_HOST || '';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB || 0);
const REDIS_SSL = (process.env.REDIS_SSL || 'false').trim().toLowerCase() === 'true';

export const HUD_PLAYER_TTL_SEC = Number(process.env.HUD_PLAYER_TTL_SEC || 300);
export const HUD_SESSION_TTL_SEC = Number(process.env.HUD_SESSION_TTL_SEC || 300);
/** Refreshed on server_status, player_join, and successful HUD reads. */
export const HUD_PRESENCE_TTL_SEC = Number(process.env.HUD_PRESENCE_TTL_SEC || 180);
/** Longer TTL on join until player_leave explicitly clears presence. */
export const HUD_PRESENCE_JOIN_TTL_SEC = Number(
  process.env.HUD_PRESENCE_JOIN_TTL_SEC || 600,
);

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function createRedisSocket() {
  return REDIS_SSL
    ? { host: REDIS_HOST, port: REDIS_PORT, tls: true as const }
    : { host: REDIS_HOST, port: REDIS_PORT };
}

export function isHudRedisConfigured(): boolean {
  return Boolean(REDIS_HOST);
}

export async function getHudRedisClient(): Promise<RedisClientType> {
  if (client?.isOpen) {
    return client;
  }
  if (connectPromise) {
    return connectPromise;
  }

  if (!REDIS_HOST) {
    throw new Error('REDIS_HOST missing for HUD cache');
  }

  connectPromise = (async () => {
    const redisClient = createClient({
      socket: createRedisSocket(),
      ...(REDIS_USERNAME ? { username: REDIS_USERNAME } : {}),
      ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
      database: REDIS_DB,
    }) as RedisClientType;

    redisClient.on('error', (err) => console.error('[hud-redis] redis error:', err));
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
