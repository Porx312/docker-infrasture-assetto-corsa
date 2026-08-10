import {
  clearUserStatusFlag,
  markUserStatusFlag,
  readUserStatusFlag,
  userStatusFlagRedisKey,
} from './userStatusFlag.js';

export const USER_INVALIDATED_REDIS_PREFIX =
  process.env.USER_INVALIDATED_REDIS_PREFIX || 'ac:user:invalidated:';
export const USER_INVALIDATED_CHANNEL =
  process.env.USER_INVALIDATED_CHANNEL || 'ac:user:invalidated';
export const USER_INVALIDATED_TTL_SEC = Number(process.env.USER_INVALIDATED_TTL_SEC || 86_400);

const FLAG_CONFIG = {
  redisPrefix: USER_INVALIDATED_REDIS_PREFIX,
  channel: USER_INVALIDATED_CHANNEL,
  ttlSec: USER_INVALIDATED_TTL_SEC,
  logLabel: 'user-ban',
};

export function userInvalidatedRedisKey(steamId: string): string {
  return userStatusFlagRedisKey(USER_INVALIDATED_REDIS_PREFIX, steamId);
}

export type UserInvalidatedMessage = {
  steamId: string;
  ts: number;
};

export async function readUserInvalidated(steamId: string): Promise<boolean> {
  return readUserStatusFlag(USER_INVALIDATED_REDIS_PREFIX, steamId);
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

export async function markUserInvalidated(
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  if (markUserInvalidatedOverride) {
    await markUserInvalidatedOverride(steamId, options);
    return;
  }
  await markUserStatusFlag(FLAG_CONFIG, steamId, options);
}

export async function clearUserInvalidated(steamId: string): Promise<void> {
  await clearUserStatusFlag(USER_INVALIDATED_REDIS_PREFIX, steamId, FLAG_CONFIG.logLabel);
}
