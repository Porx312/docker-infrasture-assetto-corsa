import {
  getHudRedisClient,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';

export type UserStatusFlagConfig = {
  redisPrefix: string;
  channel: string;
  ttlSec: number;
  logLabel: string;
};

export function userStatusFlagRedisKey(prefix: string, steamId: string): string {
  return `${prefix}${steamId.trim()}`;
}

export async function readUserStatusFlag(
  redisPrefix: string,
  steamId: string,
): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return false;
  }
  const value = await hudRedisGet(userStatusFlagRedisKey(redisPrefix, steamId));
  return value !== null;
}

export async function markUserStatusFlag(
  config: UserStatusFlagConfig,
  steamId: string,
  options?: { publish?: boolean },
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const key = userStatusFlagRedisKey(config.redisPrefix, trimmed);
  const message = { steamId: trimmed, ts: Date.now() };
  const redis = await getHudRedisClient();
  await hudRedisSet(key, '1', config.ttlSec);
  if (options?.publish === true) {
    await redis.publish(config.channel, JSON.stringify(message));
  }
  console.log(`[${config.logLabel}] marked steamId=${trimmed}`);
}

export async function clearUserStatusFlag(redisPrefix: string, steamId: string, logLabel: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || !isHudRedisConfigured()) {
    return;
  }
  await hudRedisDel(userStatusFlagRedisKey(redisPrefix, trimmed));
  console.log(`[${logLabel}] cleared steamId=${trimmed}`);
}
