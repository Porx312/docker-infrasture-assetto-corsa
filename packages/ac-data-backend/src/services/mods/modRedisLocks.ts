import { createRedisClient, connectRedisClient, isRedisConfigured } from '../redisClient.js';

let client: Awaited<ReturnType<typeof connectRedisClient>> | null = null;

async function getClient() {
  if (!isRedisConfigured()) {
    return null;
  }
  if (!client) {
    client = await connectRedisClient(createRedisClient('mod-locks'));
  }
  return client;
}

export async function tryAcquireModLock(
  edgeId: string,
  sha256: string,
  holder: string,
  ttlSec = 7200,
): Promise<boolean> {
  const redis = await getClient();
  if (!redis) {
    return true;
  }
  const key = `mod:lock:${edgeId}:${sha256}`;
  const result = await redis.set(key, holder, { NX: true, EX: ttlSec });
  return result === 'OK';
}

export async function releaseModLock(edgeId: string, sha256: string, holder: string): Promise<void> {
  const redis = await getClient();
  if (!redis) {
    return;
  }
  const key = `mod:lock:${edgeId}:${sha256}`;
  const current = await redis.get(key);
  if (current === holder) {
    await redis.del(key);
  }
}

/** Force-delete lock (stale running reclaim / dead agent). */
export async function forceReleaseModLock(edgeId: string, sha256: string): Promise<void> {
  const redis = await getClient();
  if (!redis) {
    return;
  }
  await redis.del(`mod:lock:${edgeId}:${sha256}`);
}
