import { fetchHudSession, isHudConvexConfigured } from './hudConvex.js';
import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import {
  isProfileInvalidated,
  normalizeHudProfile,
  playerResultFromSession,
  profileCosmeticsFingerprint,
} from './hudProfile.js';
import {
  HUD_PLAYER_TTL_SEC,
  HUD_SESSION_TTL_SEC,
  HUD_TRANSIENT_ERROR_TTL_SEC,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
} from './hudRedis.js';
import { bumpBoardVersion, bumpPlayerVersion } from './hudVersion.js';
import {
  clearUserInvalidated,
  markUserInvalidated,
  USER_INVALIDATED_TTL_SEC,
} from './hudUserInvalidation.js';
import type {
  BoardCacheParams,
  HudPlayerResult,
  HudSessionResult,
  PlayerCacheParams,
  SessionQueryParams,
} from './hudTypes.js';
import { isTransientHudErrorReason, TRANSIENT_HUD_ERROR_REASONS } from './hudTransientReasons.js';
import {
  invalidateHudCachesForSteamId,
  invalidatePlayerCache,
  invalidateSessionCache,
} from './hudSessionCache.js';

export {
  invalidateHudCachesForSteamId,
  invalidatePlayerCache,
  invalidateSessionCache,
} from './hudSessionCache.js';

const HUD_SESSION_RIVALS_RETRY_ATTEMPTS = Number(process.env.HUD_SESSION_RIVALS_RETRY_ATTEMPTS || 3);
const HUD_SESSION_RIVALS_RETRY_MS = Number(process.env.HUD_SESSION_RIVALS_RETRY_MS || 300);
const HUD_SESSION_FETCH_RETRY_ATTEMPTS = Number(
  process.env.HUD_SESSION_FETCH_RETRY_ATTEMPTS ||
    process.env.HUD_PLAYER_FETCH_RETRY_ATTEMPTS ||
    3,
);
const HUD_SESSION_FETCH_RETRY_MS = Number(
  process.env.HUD_SESSION_FETCH_RETRY_MS || process.env.HUD_PLAYER_FETCH_RETRY_MS || 400,
);
const HUD_BATTLE_ELO_RETRY_ATTEMPTS = Number(process.env.HUD_BATTLE_ELO_RETRY_ATTEMPTS || 3);
const HUD_BATTLE_ELO_RETRY_MS = Number(process.env.HUD_BATTLE_ELO_RETRY_MS || 400);

export type RefreshPlayerHudCacheOptions = PlayerCacheParams & {
  lastLapMs?: number;
  source?: 'lap' | 'battle';
  retryEloUntilChange?: boolean;
};

export type RefreshPlayerHudCacheResult = {
  player: HudPlayerResult;
  session: HudSessionResult;
  previousElo: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stable fingerprint for rank, rivals, elo/tier, and profile cosmetics (SSE skip guard). */
export function sessionLeaderboardFingerprint(result: HudSessionResult): string {
  if (!result.ok || !result.profile) {
    return '';
  }
  const rivals = result.profile.rivals;
  const rankPart = [
    result.profile.rank,
    rivals.above?.rank ?? '',
    rivals.above?.lap_ms ?? '',
    rivals.below?.rank ?? '',
    rivals.below?.lap_ms ?? '',
    result.profile.elo ?? '',
    result.profile.tier ?? '',
  ].join(':');
  const cosmeticsPart = profileCosmeticsFingerprint(result.profile);
  return cosmeticsPart ? `${rankPart}|${cosmeticsPart}` : rankPart;
}

export function sessionHudUnchanged(before: string | null, after: string | null): boolean {
  if (before === null || after === null || before === '' || after === '') {
    return false;
  }
  return before === after;
}

export async function readCachedSessionFingerprint(steamId: string): Promise<string | null> {
  const redisKey = sessionRedisKey(buildSessionCacheKey({ steamId }));
  const cached = await readCachedSessionResult(redisKey);
  if (!cached?.ok) {
    return null;
  }
  const fingerprint = sessionLeaderboardFingerprint(cached);
  return fingerprint === '' ? null : fingerprint;
}

function applyLastLapToPlayerResult(
  result: HudPlayerResult,
  lastLapMs?: number,
): HudPlayerResult {
  if (!lastLapMs || !Number.isFinite(lastLapMs) || lastLapMs <= 0 || !result.ok) {
    return result;
  }

  const profile = result.profile ? { ...result.profile, last_lap_ms: lastLapMs } : null;
  return { ok: true, profile };
}

type FetchHudSessionFn = typeof fetchHudSession;

let fetchHudSessionImpl: FetchHudSessionFn = fetchHudSession;

/** Test helper: override Convex session fetch. */
export function setFetchHudSessionForTests(fn: FetchHudSessionFn | null): void {
  fetchHudSessionImpl = fn ?? fetchHudSession;
}

/** TTL for caching failed HUD reads; null means do not cache. */
export function hudErrorCacheTtlSec(reason: string, defaultTtlSec: number): number | null {
  if (reason === 'player_not_connected' || reason === 'convex_unreachable') {
    return null;
  }
  if (reason === 'user_invalidated') {
    return USER_INVALIDATED_TTL_SEC;
  }
  if (TRANSIENT_HUD_ERROR_REASONS.has(reason)) {
    return HUD_TRANSIENT_ERROR_TTL_SEC;
  }
  return defaultTtlSec;
}

async function syncUserInvalidationFromHudResults(
  steamId: string,
  player?: HudPlayerResult,
  session?: HudSessionResult,
): Promise<void> {
  const playerInvalid =
    player !== undefined &&
    ((!player.ok && player.reason === 'user_invalidated') ||
      (player.ok && isProfileInvalidated(player.profile)));
  const sessionInvalid =
    session !== undefined &&
    ((!session.ok && session.reason === 'user_invalidated') ||
      (session.ok && isProfileInvalidated(session.profile)));

  if (playerInvalid || sessionInvalid) {
    await markUserInvalidated(steamId);
    return;
  }

  const playerValid =
    player === undefined || (player.ok && !isProfileInvalidated(player.profile));
  const sessionValid =
    session === undefined || (session.ok && !isProfileInvalidated(session.profile));
  if (playerValid && sessionValid && (player !== undefined || session !== undefined)) {
    await clearUserInvalidated(steamId);
  }
}

export async function persistPlayerCacheResult(redisKey: string, result: HudPlayerResult): Promise<void> {
  if (!result.ok) {
    const ttl = hudErrorCacheTtlSec(result.reason, HUD_PLAYER_TTL_SEC);
    if (ttl === null) {
      return;
    }
    await hudRedisSet(redisKey, JSON.stringify(result), ttl);
    return;
  }
  await hudRedisSet(redisKey, JSON.stringify(result), HUD_PLAYER_TTL_SEC);
}

export async function persistSessionCacheResult(redisKey: string, result: HudSessionResult): Promise<void> {
  if (!result.ok) {
    const ttl = hudErrorCacheTtlSec(result.reason, HUD_SESSION_TTL_SEC);
    if (ttl === null) {
      return;
    }
    await hudRedisSet(redisKey, JSON.stringify(result), ttl);
    return;
  }
  await hudRedisSet(redisKey, JSON.stringify(result), HUD_SESSION_TTL_SEC);
}

async function persistDerivedPlayerAndSessionCaches(
  params: PlayerCacheParams,
  session: HudSessionResult,
  player: HudPlayerResult,
): Promise<void> {
  const playerKey = playerRedisKey(buildPlayerCacheKey(params));
  const sessionKey = sessionRedisKey(buildSessionCacheKey(params));
  await persistSessionCacheResult(sessionKey, session);
  await persistPlayerCacheResult(playerKey, player);
  if (player.ok) {
    await bumpPlayerVersion(params);
  }
}

function isUncachedTransientError(result: HudPlayerResult | HudSessionResult): boolean {
  return !result.ok && result.reason === 'player_not_connected';
}

function isTransientHudFailure(result: HudPlayerResult | HudSessionResult): boolean {
  if (result.ok) {
    return false;
  }
  return result.reason === 'player_not_connected' || isTransientHudErrorReason(result.reason);
}

async function readCachedSessionFallback(redisKey: string): Promise<HudSessionResult | null> {
  return readCachedSessionResult(redisKey);
}

async function readCachedSessionResult(redisKey: string): Promise<HudSessionResult | null> {
  const cached = await hudRedisGet(redisKey);
  if (!cached) {
    return null;
  }
  try {
    const parsed = normalizeSessionResult(JSON.parse(cached) as HudSessionResult);
    if (isUncachedTransientError(parsed)) {
      await hudRedisDel(redisKey);
      return null;
    }
    if (parsed.ok && isProfileInvalidated(parsed.profile)) {
      return { ok: false, reason: 'user_invalidated' };
    }
    return parsed.ok ? parsed : null;
  } catch {
    return null;
  }
}

/** Fetch session from Convex without deleting Redis cache; keep prior OK entry on transient failure. */
export async function refreshSessionCached(params: SessionQueryParams): Promise<HudSessionResult> {
  const redisKey = sessionRedisKey(buildSessionCacheKey(params));
  const fallback = await readCachedSessionFallback(redisKey);

  if (!isHudConvexConfigured()) {
    return fallback ?? { ok: false, reason: 'user_not_found' };
  }

  const result = normalizeSessionResult(await fetchHudSessionImpl(params));
  if (result.ok && isProfileInvalidated(result.profile)) {
    const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
    await persistSessionCacheResult(redisKey, invalidated);
    await markUserInvalidated(params.steamId);
    return invalidated;
  }

  if (result.ok) {
    await persistSessionCacheResult(redisKey, result);
    return result;
  }

  if (!result.ok && result.reason === 'user_invalidated') {
    await persistSessionCacheResult(redisKey, result);
    await markUserInvalidated(params.steamId);
    return result;
  }

  if (fallback && isTransientHudFailure(result)) {
    return fallback;
  }

  return result;
}

/** Lap refresh with rivals fingerprint retry until Convex propagates rank/rivals changes. */
export async function refreshPlayerHudCacheForLap(
  job: RefreshPlayerHudCacheOptions,
): Promise<RefreshPlayerHudCacheResult> {
  const sessionParams: SessionQueryParams = { steamId: job.steamId };
  const redisKey = sessionRedisKey(buildSessionCacheKey(sessionParams));
  const previous = await readCachedSessionFallback(redisKey);
  const previousFingerprint =
    previous?.ok ? sessionLeaderboardFingerprint(previous) : null;

  let result = await refreshPlayerHudCache({ ...job, source: 'lap' });

  for (let attempt = 1; attempt < HUD_SESSION_RIVALS_RETRY_ATTEMPTS; attempt++) {
    if (!result.session.ok || !previousFingerprint) {
      break;
    }
    const nextFingerprint = sessionLeaderboardFingerprint(result.session);
    if (nextFingerprint !== previousFingerprint) {
      break;
    }
    await sleep(HUD_SESSION_RIVALS_RETRY_MS);
    result = await refreshPlayerHudCache({ ...job, source: 'lap' });
  }

  return result;
}

function normalizePlayerResult(result: HudPlayerResult): HudPlayerResult {
  if (!result.ok || !result.profile) {
    return result;
  }
  const profile = normalizeHudProfile(result.profile);
  if (!profile) {
    return { ok: true, profile: null };
  }
  return { ok: true, profile };
}

function normalizeSessionResult(result: HudSessionResult): HudSessionResult {
  if (!result.ok || !result.profile) {
    return result;
  }
  const profile = normalizeHudProfile(result.profile);
  if (!profile) {
    return { ...result, profile: null };
  }
  return { ...result, profile };
}

export async function bumpBoardVersionsForLap(job: {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
}): Promise<void> {
  const boards: BoardCacheParams[] = [
    { serverName: job.serverName, track: job.track, trackConfig: job.trackConfig, car: 'global' },
  ];
  if (job.carModel) {
    boards.push({
      serverName: job.serverName,
      track: job.track,
      trackConfig: job.trackConfig,
      car: job.carModel,
    });
  }
  await Promise.all(boards.map((params) => bumpBoardVersion(params)));
}

export async function readCachedProfileBestLapMs(params: PlayerCacheParams): Promise<number | null> {
  const cached = await hudRedisGet(playerRedisKey(buildPlayerCacheKey(params)));
  if (!cached) {
    return null;
  }
  try {
    const parsed = JSON.parse(cached) as HudPlayerResult;
    if (parsed.ok && parsed.profile && parsed.profile.best_lap_ms > 0) {
      return parsed.profile.best_lap_ms;
    }
  } catch {
    return null;
  }
  return null;
}

/** True when lapTime beats cached profile best (or cache/profile best is unknown). */
export async function isLapPersonalBest(
  params: PlayerCacheParams,
  lapTimeMs: number,
): Promise<boolean> {
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
    return true;
  }
  const previousBest = await readCachedProfileBestLapMs(params);
  if (previousBest === null) {
    return true;
  }
  return lapTimeMs < previousBest;
}

/** Update last_lap_ms in Redis player+session caches without Convex fetch or invalidation. */
export async function patchLastLapInCaches(
  params: PlayerCacheParams,
  lapTimeMs: number,
): Promise<boolean> {
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) {
    return false;
  }

  const sessionKey = sessionRedisKey(buildSessionCacheKey(params));
  const playerKey = playerRedisKey(buildPlayerCacheKey(params));
  const sessionCached = await readCachedSessionResult(sessionKey);
  if (!sessionCached?.ok) {
    return false;
  }

  const sessionProfile = sessionCached.profile
    ? { ...sessionCached.profile, last_lap_ms: lapTimeMs }
    : null;

  const updatedSession: HudSessionResult = {
    ...sessionCached,
    profile: sessionProfile,
  };
  const updatedPlayer = applyLastLapToPlayerResult(
    normalizePlayerResult(playerResultFromSession(updatedSession)),
    lapTimeMs,
  );

  await persistSessionCacheResult(sessionKey, updatedSession);
  await persistPlayerCacheResult(playerKey, updatedPlayer);
  return true;
}

export async function readCachedProfileElo(params: PlayerCacheParams): Promise<number | null> {
  const cached = await hudRedisGet(playerRedisKey(buildPlayerCacheKey(params)));
  if (!cached) {
    return null;
  }
  try {
    const parsed = JSON.parse(cached) as HudPlayerResult;
    if (parsed.ok && parsed.profile && typeof parsed.profile.elo === 'number' && parsed.profile.elo > 0) {
      return parsed.profile.elo;
    }
  } catch {
    return null;
  }
  return null;
}

async function hasHudPresence(steamId: string): Promise<boolean> {
  const { resolvePlayerPresence } = await import('./hudPlayerPresence.js');
  const resolved = await resolvePlayerPresence(steamId);
  return resolved.ok;
}

function shouldRetryHudFetch(result: HudPlayerResult | HudSessionResult): boolean {
  return !result.ok && isTransientHudFailure(result);
}

function sessionElo(result: HudSessionResult): number {
  if (!result.ok || !result.profile) {
    return 0;
  }
  return result.profile.elo ?? 0;
}

export async function fetchHudSessionWithRetry(
  params: SessionQueryParams,
  options: { retryEloUntilChange?: boolean; previousElo?: number | null } = {},
): Promise<HudSessionResult> {
  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const maxAttempts = options.retryEloUntilChange
    ? HUD_BATTLE_ELO_RETRY_ATTEMPTS
    : HUD_SESSION_FETCH_RETRY_ATTEMPTS;
  const retryMs = options.retryEloUntilChange ? HUD_BATTLE_ELO_RETRY_MS : HUD_SESSION_FETCH_RETRY_MS;

  let last = normalizeSessionResult(await fetchHudSessionImpl(params));

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    if (last.ok) {
      if (options.retryEloUntilChange && options.previousElo != null) {
        const nextElo = sessionElo(last);
        if (nextElo > 0 && nextElo !== options.previousElo) {
          break;
        }
      } else {
        break;
      }
    } else if (!shouldRetryHudFetch(last)) {
      break;
    }

    if (!last.ok && last.reason === 'player_not_connected') {
      const presenceOk = await hasHudPresence(params.steamId);
      if (!presenceOk) {
        break;
      }
    }

    await sleep(retryMs);
    last = normalizeSessionResult(await fetchHudSessionImpl(params));
  }

  return last;
}

export function logHudRefreshDetail(
  steamId: string,
  source: 'lap' | 'battle',
  previousElo: number | null,
  player: HudPlayerResult,
  session: HudSessionResult,
): void {
  const playerElo = player.ok ? (player.profile?.elo ?? 0) : 0;
  const eloPart =
    previousElo != null && player.ok && playerElo > 0
      ? `elo=${previousElo}→${playerElo}`
      : player.ok
        ? `elo=${playerElo}`
        : `elo=n/a player=${player.reason}`;
  const rank = session.ok ? session.profile?.rank : undefined;
  const rivalAbove = session.ok ? session.profile?.rivals.above?.name : undefined;
  const sessionStatus = session.ok ? 'ok' : session.reason;

  console.log(
    `[hud-refresh-detail] steamId=${steamId} source=${source} ${eloPart} rank=${rank ?? 'n/a'} rivalAbove=${rivalAbove ?? 'null'} session=${sessionStatus}`,
  );
}

export async function refreshPlayerHudCache(
  job: RefreshPlayerHudCacheOptions,
): Promise<RefreshPlayerHudCacheResult> {
  const sessionParams: SessionQueryParams = { steamId: job.steamId };
  const previousElo = await readCachedProfileElo(job);

  await invalidatePlayerCache(job);
  await invalidateSessionCache(sessionParams);

  const sessionResult = await fetchHudSessionWithRetry(sessionParams, {
    retryEloUntilChange: job.retryEloUntilChange === true,
    previousElo,
  });

  const normalizedSession = normalizeSessionResult(sessionResult);
  const normalizedPlayer = applyLastLapToPlayerResult(
    normalizePlayerResult(playerResultFromSession(normalizedSession)),
    job.lastLapMs,
  );

  await persistDerivedPlayerAndSessionCaches(job, normalizedSession, normalizedPlayer);
  await syncUserInvalidationFromHudResults(job.steamId, normalizedPlayer, normalizedSession);

  if (job.source) {
    logHudRefreshDetail(job.steamId, job.source, previousElo, normalizedPlayer, normalizedSession);
  }

  return {
    player: normalizedPlayer,
    session: normalizedSession,
    previousElo,
  };
}

export async function getPlayerCached(params: PlayerCacheParams): Promise<HudPlayerResult> {
  const cacheKey = buildPlayerCacheKey(params);
  const redisKey = playerRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = normalizePlayerResult(JSON.parse(cached) as HudPlayerResult);
    if (isUncachedTransientError(parsed)) {
      await hudRedisDel(redisKey);
    } else {
      if (parsed.ok && isProfileInvalidated(parsed.profile)) {
        const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
        await markUserInvalidated(params.steamId);
        return invalidated;
      }
      if (!parsed.ok && parsed.reason === 'user_invalidated') {
        await markUserInvalidated(params.steamId);
        return parsed;
      }
      if (parsed.ok) {
        await syncUserInvalidationFromHudResults(params.steamId, parsed);
      }
      return parsed;
    }
  }

  const sessionKey = sessionRedisKey(buildSessionCacheKey(params));
  const sessionCached = await hudRedisGet(sessionKey);
  if (sessionCached) {
    try {
      const session = normalizeSessionResult(JSON.parse(sessionCached) as HudSessionResult);
      if (!isUncachedTransientError(session)) {
        const derived = normalizePlayerResult(playerResultFromSession(session));
        if (derived.ok && isProfileInvalidated(derived.profile)) {
          const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
          await markUserInvalidated(params.steamId);
          return invalidated;
        }
        if (!derived.ok && derived.reason === 'user_invalidated') {
          await markUserInvalidated(params.steamId);
          return derived;
        }
        if (derived.ok) {
          await syncUserInvalidationFromHudResults(params.steamId, derived, session);
        }
        return derived;
      }
    } catch {
      // fall through to Convex fetch
    }
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const session = normalizeSessionResult(await fetchHudSessionImpl(params));
  const result = normalizePlayerResult(playerResultFromSession(session));

  if (session.ok && isProfileInvalidated(session.profile)) {
    const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
    await persistDerivedPlayerAndSessionCaches(params, invalidated, invalidated);
    await markUserInvalidated(params.steamId);
    return invalidated;
  }

  if (!session.ok && session.reason === 'user_invalidated') {
    const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
    await persistDerivedPlayerAndSessionCaches(params, session, invalidated);
    await markUserInvalidated(params.steamId);
    return invalidated;
  }

  await persistDerivedPlayerAndSessionCaches(params, session, result);
  if (result.ok) {
    await syncUserInvalidationFromHudResults(params.steamId, result, session);
  } else if (result.reason === 'user_invalidated') {
    await markUserInvalidated(params.steamId);
  }
  return result;
}

async function resolveSessionCacheEntry(
  params: SessionQueryParams,
  redisKey: string,
  cached: string,
  options: { deleteStaleNotConnected: boolean },
): Promise<HudSessionResult | null> {
  const parsed = normalizeSessionResult(JSON.parse(cached) as HudSessionResult);
  if (isUncachedTransientError(parsed)) {
    if (options.deleteStaleNotConnected) {
      await hudRedisDel(redisKey);
      return null;
    }
    return parsed;
  }

  if (parsed.ok && isProfileInvalidated(parsed.profile)) {
    const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
    await markUserInvalidated(params.steamId);
    return invalidated;
  }
  if (!parsed.ok && parsed.reason === 'user_invalidated') {
    await markUserInvalidated(params.steamId);
    return parsed;
  }
  if (parsed.ok) {
    await syncUserInvalidationFromHudResults(params.steamId, undefined, parsed);
  }
  return parsed;
}

/** Redis-only session read; never calls Convex. Returns null on cache miss. */
export async function peekSessionCache(params: SessionQueryParams): Promise<HudSessionResult | null> {
  const redisKey = sessionRedisKey(buildSessionCacheKey(params));
  const cached = await hudRedisGet(redisKey);
  if (!cached) {
    return null;
  }
  try {
    return await resolveSessionCacheEntry(params, redisKey, cached, {
      deleteStaleNotConnected: false,
    });
  } catch {
    return null;
  }
}

export async function getSessionCached(params: SessionQueryParams): Promise<HudSessionResult> {
  const cacheKey = buildSessionCacheKey(params);
  const redisKey = sessionRedisKey(cacheKey);

  const cached = await hudRedisGet(redisKey);
  if (cached) {
    const parsed = await resolveSessionCacheEntry(params, redisKey, cached, {
      deleteStaleNotConnected: true,
    });
    if (parsed) {
      return parsed;
    }
  }

  if (!isHudConvexConfigured()) {
    return { ok: false, reason: 'user_not_found' };
  }

  const result = normalizeSessionResult(await fetchHudSessionImpl(params));
  if (result.ok && isProfileInvalidated(result.profile)) {
    const invalidated = { ok: false as const, reason: 'user_invalidated' as const };
    await persistSessionCacheResult(redisKey, invalidated);
    await markUserInvalidated(params.steamId);
    return invalidated;
  }

  await persistSessionCacheResult(redisKey, result);
  if (result.ok) {
    await syncUserInvalidationFromHudResults(params.steamId, undefined, result);
  } else if (result.reason === 'user_invalidated') {
    await markUserInvalidated(params.steamId);
  }
  return result;
}
