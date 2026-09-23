import { profileCosmeticsFingerprint } from './hudProfile.js';
import {
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  isHudRedisConfigured,
} from './hudRedis.js';
import type { HudProfile } from './hudTypes.js';

export const USER_PROFILE_COSMETICS_FP_PREFIX =
  process.env.USER_PROFILE_COSMETICS_FP_PREFIX || 'ac:user:profile:cosmetics_fp:';
export const USER_PROFILE_COSMETICS_TTL_SEC = Number(
  process.env.USER_PROFILE_COSMETICS_TTL_SEC || process.env.USER_PREFS_TTL_SEC || 86_400,
);

export type SyncProfileCosmeticsOptions = {
  /** When true (worker refresh-user), log structured diff for observability. */
  logChanges?: boolean;
};

export type SyncProfileCosmeticsResult = {
  changed: boolean;
  previous: string;
  next: string;
};

export function profileCosmeticsRedisKey(steamId: string): string {
  return `${USER_PROFILE_COSMETICS_FP_PREFIX}${steamId.trim()}`;
}

export async function readProfileCosmeticsFingerprint(steamId: string): Promise<string | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return null;
  }
  const value = await hudRedisGet(profileCosmeticsRedisKey(trimmed));
  return value ?? null;
}

/** Mirror Convex profile cosmetics to Redis fingerprint for change detection / verify scripts. */
export async function syncProfileCosmeticsFromProfile(
  steamId: string,
  profile: HudProfile | null | undefined,
  options?: SyncProfileCosmeticsOptions,
): Promise<SyncProfileCosmeticsResult> {
  const trimmed = steamId.trim();
  const next = profileCosmeticsFingerprint(profile);
  const emptyResult: SyncProfileCosmeticsResult = { changed: false, previous: '', next };

  if (!trimmed || trimmed.startsWith('unknown_') || !isHudRedisConfigured()) {
    return emptyResult;
  }

  const previous = (await readProfileCosmeticsFingerprint(trimmed)) ?? '';
  const changed = previous !== next;

  if (next === '') {
    await hudRedisDel(profileCosmeticsRedisKey(trimmed));
  } else {
    await hudRedisSet(profileCosmeticsRedisKey(trimmed), next, USER_PROFILE_COSMETICS_TTL_SEC);
  }

  if (options?.logChanges && profile != null && changed) {
    console.log(
      `[profile-cosmetics] steamId=${trimmed} changed=true prev=${previous || '(none)'} next=${next}`,
    );
  }

  return { changed, previous, next };
}

export async function clearProfileCosmeticsFingerprint(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || !isHudRedisConfigured()) {
    return;
  }
  await hudRedisDel(profileCosmeticsRedisKey(trimmed));
}
