import '../config/loadEnv.js';
import { createClient, type RedisClientType } from 'redis';

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_HOST);
}

export function getRedisSocketOptions(): { host: string; port: number; tls?: true } {
  const host = process.env.REDIS_HOST || '';
  const port = Number(process.env.REDIS_PORT || 6379);
  const ssl = (process.env.REDIS_SSL || 'false').trim().toLowerCase() === 'true';
  return ssl ? { host, port, tls: true as const } : { host, port };
}

export function getRedisClientOptions() {
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;
  const database = Number(process.env.REDIS_DB || 0);
  return {
    socket: getRedisSocketOptions(),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    database,
  };
}

/** Create a Redis client with shared env config. Caller must connect (or use connectRedisClient). */
export function createRedisClient(logPrefix = 'redis'): RedisClientType {
  const client = createClient(getRedisClientOptions()) as RedisClientType;
  client.on('error', (err) => console.error(`[${logPrefix}] redis error:`, err));
  return client;
}

export async function connectRedisClient(client: RedisClientType): Promise<RedisClientType> {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}
