import '../../config/loadEnv.js';
import { createClient, type RedisClientType } from 'redis';

const REDIS_HOST = process.env.REDIS_HOST || '';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_USERNAME = process.env.REDIS_USERNAME || undefined;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = Number(process.env.REDIS_DB || 0);
const REDIS_SSL = (process.env.REDIS_SSL || 'false').trim().toLowerCase() === 'true';

export const HUD_LB_TTL_SEC = Number(process.env.HUD_LB_TTL_SEC || 300);
export const HUD_PLAYER_TTL_SEC = Number(process.env.HUD_PLAYER_TTL_SEC || 300);

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
