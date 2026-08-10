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

export type UserPrefKind = 'acceptBattle' | 'saveTime';

export type UserPrefNotifyMessage = {
  steamId: string;
  pref: UserPrefKind;
  enabled: boolean;
  ts: number;
};

export type SyncUserPrefsOptions = {
  /** When true (worker refresh-user), pub/sub private chat for changed prefs. */
  notifyPrefChanges?: boolean;
};

type PublishPrefChangeFn = (
  steamId: string,
  pref: UserPrefKind,
  enabled: boolean,
) => Promise<void>;

let publishPrefChangeOverride: PublishPrefChangeFn | null = null;

/** Test helper: override pref pub/sub notify. */
export function setPublishPrefChangeForTests(fn: PublishPrefChangeFn | null): void {
  publishPrefChangeOverride = fn;
}

/** @deprecated use setPublishPrefChangeForTests */
export function setPublishAcceptBattlePrefChangeForTests(
  fn: ((steamId: string, acceptBattle: boolean) => Promise<void>) | null,
): void {
  if (!fn) {
    publishPrefChangeOverride = null;
    return;
  }
  publishPrefChangeOverride = async (steamId, pref, enabled) => {
    if (pref === 'acceptBattle') {
      await fn(steamId, enabled);
    }
  };
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

async function publishPrefChangeImpl(
  steamId: string,
  pref: UserPrefKind,
  enabled: boolean,
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return;
  }

  const message: UserPrefNotifyMessage = {
    steamId: trimmed,
    pref,
    enabled,
    ts: Date.now(),
  };
  const redis = await getHudRedisClient();
  await redis.publish(USER_PREFS_NOTIFY_CHANNEL, JSON.stringify(message));
  console.log(
    `[user-prefs] notify pref=${pref} enabled=${enabled} steamId=${trimmed} channel=${USER_PREFS_NOTIFY_CHANNEL}`,
  );
}

async function publishPrefChange(
  steamId: string,
  pref: UserPrefKind,
  enabled: boolean,
): Promise<void> {
  if (publishPrefChangeOverride) {
    await publishPrefChangeOverride(steamId, pref, enabled);
    return;
  }
  await publishPrefChangeImpl(steamId, pref, enabled);
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

  const previousSaveTime = await readSaveTimeEnabled(trimmed);
  const previousAcceptBattle = await readAcceptBattleEnabled(trimmed);
  const nextSaveTime = profileSaveTimeEnabled(profile);
  const nextAcceptBattle = profileAcceptBattleEnabled(profile);

  await setPrefKey(saveTimeRedisKey(trimmed), nextSaveTime);
  await setPrefKey(acceptBattleRedisKey(trimmed), nextAcceptBattle);

  if (options?.notifyPrefChanges && profile != null) {
    if (previousAcceptBattle !== nextAcceptBattle) {
      await publishPrefChange(trimmed, 'acceptBattle', nextAcceptBattle);
    }
    if (previousSaveTime !== nextSaveTime) {
      await publishPrefChange(trimmed, 'saveTime', nextSaveTime);
    }
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
