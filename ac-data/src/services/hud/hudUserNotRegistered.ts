import {
  getHudRedisClient,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';

export const USER_NOT_REGISTERED_REDIS_PREFIX =
  process.env.USER_NOT_REGISTERED_REDIS_PREFIX || 'ac:user:not_registered:';
export const USER_NOT_REGISTERED_CHANNEL =
  process.env.USER_NOT_REGISTERED_CHANNEL || 'ac:user:not_registered';
export const USER_REGISTERED_CHANNEL =
  process.env.USER_REGISTERED_CHANNEL || 'ac:user:registered';
export const USER_NOT_REGISTERED_TTL_SEC = Number(
  process.env.USER_NOT_REGISTERED_TTL_SEC || 86_400,
);

export function userNotRegisteredRedisKey(steamId: string): string {
  return `${USER_NOT_REGISTERED_REDIS_PREFIX}${steamId.trim()}`;
}

export type UserNotRegisteredMessage = {
  steamId: string;
  ts: number;
};

export type UserRegisteredWelcomeMessage = {
  steamId: string;
  ts: number;
};

export async function readUserNotRegistered(steamId: string): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return false;
  }
  const value = await hudRedisGet(userNotRegisteredRedisKey(steamId));
  return value !== null;
}

type MarkNotRegisteredFn = (
  steamId: string,
  options?: { publish?: boolean },
) => Promise<void>;

let markUserNotRegisteredOverride: MarkNotRegisteredFn | null = null;

/** Test helper: override markUserNotRegistered. */
export function setMarkUserNotRegisteredForTests(fn: MarkNotRegisteredFn | null): void {
  markUserNotRegisteredOverride = fn;
}

async function markUserNotRegisteredImpl(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const key = userNotRegisteredRedisKey(trimmed);
  const message: UserNotRegisteredMessage = { steamId: trimmed, ts: Date.now() };
  const redis = await getHudRedisClient();
  await hudRedisSet(key, '1', USER_NOT_REGISTERED_TTL_SEC);
  if (options?.publish !== false) {
    await redis.publish(USER_NOT_REGISTERED_CHANNEL, JSON.stringify(message));
  }
  console.log(`[user-registration] marked steamId=${trimmed}`);
}

export async function markUserNotRegistered(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  if (markUserNotRegisteredOverride) {
    await markUserNotRegisteredOverride(steamId, options);
    return;
  }
  await markUserNotRegisteredImpl(steamId, options);
}

export async function clearUserNotRegistered(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || !isHudRedisConfigured()) {
    return;
  }
  await hudRedisDel(userNotRegisteredRedisKey(trimmed));
  console.log(`[user-registration] cleared steamId=${trimmed}`);
}

/** Pub/sub after worker refresh clears not_registered (Steam linked mid-session). */
export async function publishUserRegisteredWelcome(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const message: UserRegisteredWelcomeMessage = { steamId: trimmed, ts: Date.now() };
  const redis = await getHudRedisClient();
  await redis.publish(USER_REGISTERED_CHANNEL, JSON.stringify(message));
  console.log(
    `[user-registration] welcome notify steamId=${trimmed} channel=${USER_REGISTERED_CHANNEL}`,
  );
}
