import {
  getHudRedisClient,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';

export const USER_INVALIDATED_REDIS_PREFIX =
  process.env.USER_INVALIDATED_REDIS_PREFIX || 'ac:user:invalidated:';
export const USER_INVALIDATED_CHANNEL =
  process.env.USER_INVALIDATED_CHANNEL || 'ac:user:invalidated';
export const USER_INVALIDATED_TTL_SEC = Number(process.env.USER_INVALIDATED_TTL_SEC || 86_400);

export function userInvalidatedRedisKey(steamId: string): string {
  return `${USER_INVALIDATED_REDIS_PREFIX}${steamId.trim()}`;
}

export type UserInvalidatedMessage = {
  steamId: string;
  ts: number;
};

export async function readUserInvalidated(steamId: string): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return false;
  }
  const value = await hudRedisGet(userInvalidatedRedisKey(steamId));
  return value !== null;
}

type MarkInvalidatedFn = (
  steamId: string,
  options?: { publish?: boolean },
) => Promise<void>;

let markUserInvalidatedOverride: MarkInvalidatedFn | null = null;

/** Test helper: override markUserInvalidated. */
export function setMarkUserInvalidatedForTests(fn: MarkInvalidatedFn | null): void {
  markUserInvalidatedOverride = fn;
}

async function markUserInvalidatedImpl(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const key = userInvalidatedRedisKey(trimmed);
  const message: UserInvalidatedMessage = { steamId: trimmed, ts: Date.now() };
  const redis = await getHudRedisClient();
  await hudRedisSet(key, '1', USER_INVALIDATED_TTL_SEC);
  if (options?.publish !== false) {
    await redis.publish(USER_INVALIDATED_CHANNEL, JSON.stringify(message));
  }
  console.log(`[user-ban] marked steamId=${trimmed}`);
}

export async function markUserInvalidated(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  if (markUserInvalidatedOverride) {
    await markUserInvalidatedOverride(steamId, options);
    return;
  }
  await markUserInvalidatedImpl(steamId, options);
}

export async function clearUserInvalidated(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || !isHudRedisConfigured()) {
    return;
  }
  await hudRedisDel(userInvalidatedRedisKey(trimmed));
  console.log(`[user-ban] cleared steamId=${trimmed}`);
}
