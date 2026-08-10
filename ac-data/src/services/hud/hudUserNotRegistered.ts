import { getHudRedisClient, isHudRedisConfigured } from './hudRedis.js';
import {
  clearUserStatusFlag,
  markUserStatusFlag,
  readUserStatusFlag,
  userStatusFlagRedisKey,
} from './userStatusFlag.js';

export const USER_NOT_REGISTERED_REDIS_PREFIX =
  process.env.USER_NOT_REGISTERED_REDIS_PREFIX || 'ac:user:not_registered:';
export const USER_NOT_REGISTERED_CHANNEL =
  process.env.USER_NOT_REGISTERED_CHANNEL || 'ac:user:not_registered';
export const USER_REGISTERED_CHANNEL =
  process.env.USER_REGISTERED_CHANNEL || 'ac:user:registered';
export const USER_NOT_REGISTERED_TTL_SEC = Number(
  process.env.USER_NOT_REGISTERED_TTL_SEC || 86_400,
);

const FLAG_CONFIG = {
  redisPrefix: USER_NOT_REGISTERED_REDIS_PREFIX,
  channel: USER_NOT_REGISTERED_CHANNEL,
  ttlSec: USER_NOT_REGISTERED_TTL_SEC,
  logLabel: 'user-registration',
};

export function userNotRegisteredRedisKey(steamId: string): string {
  return userStatusFlagRedisKey(USER_NOT_REGISTERED_REDIS_PREFIX, steamId);
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
  return readUserStatusFlag(USER_NOT_REGISTERED_REDIS_PREFIX, steamId);
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

export async function markUserNotRegistered(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  if (markUserNotRegisteredOverride) {
    await markUserNotRegisteredOverride(steamId, options);
    return;
  }
  await markUserStatusFlag(FLAG_CONFIG, steamId, options);
}

export async function clearUserNotRegistered(steamId: string): Promise<void> {
  await clearUserStatusFlag(USER_NOT_REGISTERED_REDIS_PREFIX, steamId, FLAG_CONFIG.logLabel);
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
