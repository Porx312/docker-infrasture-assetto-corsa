import {
  getHudRedisClient,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';
import type { HudProfile } from './hudTypes.js';

export const USER_PREFS_SAVE_TIME_PREFIX =
  process.env.USER_PREFS_SAVE_TIME_PREFIX || 'ac:user:prefs:save_time:';
export const USER_PREFS_ACCEPT_BATTLE_PREFIX =
  process.env.USER_PREFS_ACCEPT_BATTLE_PREFIX || 'ac:user:prefs:accept_battle:';
export const USER_PREFS_NOTIFY_CHANNEL =
  process.env.USER_PREFS_NOTIFY_CHANNEL || 'ac:user:prefs:notify';
export const USER_PREFS_TTL_SEC = Number(process.env.USER_PREFS_TTL_SEC || 86_400);

const PREFS_DISABLED_VALUE = '0';

export type AcceptBattlePrefNotifyMessage = {
  steamId: string;
  acceptBattle: boolean;
  ts: number;
};

export type SyncUserPrefsOptions = {
  /** When true (worker refresh-user), pub/sub private chat if acceptBattle changed. */
  notifyAcceptBattleChange?: boolean;
};

type PublishAcceptBattleFn = (steamId: string, acceptBattle: boolean) => Promise<void>;

let publishAcceptBattlePrefChangeOverride: PublishAcceptBattleFn | null = null;

/** Test helper: override acceptBattle pub/sub notify. */
export function setPublishAcceptBattlePrefChangeForTests(fn: PublishAcceptBattleFn | null): void {
  publishAcceptBattlePrefChangeOverride = fn;
}

export function saveTimeRedisKey(steamId: string): string {
  return `${USER_PREFS_SAVE_TIME_PREFIX}${steamId.trim()}`;
}

export function acceptBattleRedisKey(steamId: string): string {
  return `${USER_PREFS_ACCEPT_BATTLE_PREFIX}${steamId.trim()}`;
}

/** Opt-out default: true unless profile explicitly sets false. */
export function profileSaveTimeEnabled(profile: HudProfile | null | undefined): boolean {
  return profile?.saveTime !== false;
}

/** Opt-out default: true unless profile explicitly sets false. */
export function profileAcceptBattleEnabled(profile: HudProfile | null | undefined): boolean {
  return profile?.acceptBattle !== false;
}

export async function readSaveTimeEnabled(steamId: string): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return true;
  }
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return true;
  }
  const value = await hudRedisGet(saveTimeRedisKey(trimmed));
  return value !== PREFS_DISABLED_VALUE;
}

export async function readAcceptBattleEnabled(steamId: string): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return true;
  }
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return true;
  }
  const value = await hudRedisGet(acceptBattleRedisKey(trimmed));
  return value !== PREFS_DISABLED_VALUE;
}

async function setPrefKey(key: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await hudRedisDel(key);
    return;
  }
  await hudRedisSet(key, PREFS_DISABLED_VALUE, USER_PREFS_TTL_SEC);
}

async function publishAcceptBattlePrefChangeImpl(
  steamId: string,
  acceptBattle: boolean,
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const message: AcceptBattlePrefNotifyMessage = {
    steamId: trimmed,
    acceptBattle,
    ts: Date.now(),
  };
  const redis = await getHudRedisClient();
  await redis.publish(USER_PREFS_NOTIFY_CHANNEL, JSON.stringify(message));
  console.log(
    `[user-prefs] notify acceptBattle=${acceptBattle} steamId=${trimmed} channel=${USER_PREFS_NOTIFY_CHANNEL}`,
  );
}

async function publishAcceptBattlePrefChange(
  steamId: string,
  acceptBattle: boolean,
): Promise<void> {
  if (publishAcceptBattlePrefChangeOverride) {
    await publishAcceptBattlePrefChangeOverride(steamId, acceptBattle);
    return;
  }
  await publishAcceptBattlePrefChangeImpl(steamId, acceptBattle);
}

/** Mirror Convex profile prefs to Redis for telemetry matchmaking / ingest filter. */
export async function syncUserPrefsFromProfile(
  steamId: string,
  profile: HudProfile | null | undefined,
  options?: SyncUserPrefsOptions,
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const previousAcceptBattle = await readAcceptBattleEnabled(trimmed);
  const nextSaveTime = profileSaveTimeEnabled(profile);
  const nextAcceptBattle = profileAcceptBattleEnabled(profile);

  await setPrefKey(saveTimeRedisKey(trimmed), nextSaveTime);
  await setPrefKey(acceptBattleRedisKey(trimmed), nextAcceptBattle);

  if (
    options?.notifyAcceptBattleChange &&
    profile != null &&
    previousAcceptBattle !== nextAcceptBattle
  ) {
    await publishAcceptBattlePrefChange(trimmed, nextAcceptBattle);
  }

  console.log(
    `[user-prefs] steamId=${trimmed} saveTime=${nextSaveTime} acceptBattle=${nextAcceptBattle}`,
  );
}

export async function clearUserPrefs(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || !isHudRedisConfigured()) {
    return;
  }
  await hudRedisDel(saveTimeRedisKey(trimmed));
  await hudRedisDel(acceptBattleRedisKey(trimmed));
}
