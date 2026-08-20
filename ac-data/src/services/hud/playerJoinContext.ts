import { fetchPlayerJoinContext, isHudConvexConfigured } from './hudConvex.js';
import {
  buildPlayerCacheKey,
  buildSessionCacheKey,
  playerRedisKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import { isProfileInvalidated, normalizeHudProfile, playerResultFromSession } from './hudProfile.js';
import {
  clearUserInvalidated,
  markUserInvalidated,
} from './hudUserInvalidation.js';
import {
  clearUserNotRegistered,
  markUserNotRegistered,
  publishUserRegisteredWelcome,
  readUserNotRegistered,
} from './hudUserNotRegistered.js';
import { syncUserPrefsFromProfile } from './hudUserPrefs.js';
import { syncProfileCosmeticsFromProfile } from './hudProfileCosmetics.js';
import {
  invalidateHudCachesForSteamId,
  persistPlayerCacheResult,
  persistSessionCacheResult,
} from './lapCompletedHudRefresh.js';
import { bumpPlayerVersion } from './hudVersion.js';
import type {
  HudPlayerResult,
  HudSessionResult,
  PlayerJoinContextResult,
  PlayerJoinUser,
} from './hudTypes.js';

type FetchPlayerJoinContextFn = typeof fetchPlayerJoinContext;

let fetchPlayerJoinContextImpl: FetchPlayerJoinContextFn = fetchPlayerJoinContext;

const JOIN_REFRESH_DEDUPE_MS = 5000;
const joinRefreshInFlight = new Map<string, Promise<void>>();
const joinRefreshCompletedAt = new Map<string, number>();
const joinRetryScheduled = new Set<string>();
const joinRetryTimers = new Map<string, NodeJS.Timeout>();
let joinRetryGeneration = 0;

let joinRetryDelayMsOverride: number | null = null;

function joinContextRetryMs(): number {
  if (joinRetryDelayMsOverride !== null) {
    return joinRetryDelayMsOverride;
  }
  return Number(process.env.HUD_JOIN_CONTEXT_RETRY_MS || 1500);
}

function shouldScheduleJoinRetry(session: HudSessionResult): boolean {
  return !session.ok && session.reason === 'player_not_connected';
}

function scheduleJoinContextRetry(
  steamId: string,
  options?: ApplyPlayerJoinContextOptions,
): void {
  if (joinRetryScheduled.has(steamId)) {
    return;
  }
  const delayMs = joinContextRetryMs();
  if (delayMs <= 0 && joinRetryDelayMsOverride !== 0) {
    return;
  }
  joinRetryScheduled.add(steamId);
  const generation = joinRetryGeneration;
  const runRetry = (): void => {
    if (generation !== joinRetryGeneration) {
      return;
    }
    joinRetryScheduled.delete(steamId);
    joinRetryTimers.delete(steamId);
    void refreshPlayerJoinFromConvex(steamId, { ...options, joinRetry: true });
  };
  if (delayMs <= 0) {
    setImmediate(runRetry);
    return;
  }
  console.log(
    `[player-join] steamId=${steamId} scheduling join retry in ${delayMs}ms (live_players race)`,
  );
  joinRetryTimers.set(steamId, setTimeout(runRetry, delayMs));
}

/** Test helper: override unified player join fetch. */
export function setFetchPlayerJoinContextForTests(fn: FetchPlayerJoinContextFn | null): void {
  fetchPlayerJoinContextImpl = fn ?? fetchPlayerJoinContext;
}

/** Test helper: reset join dedupe state. */
export function resetPlayerJoinDedupeForTests(): void {
  joinRetryGeneration += 1;
  for (const timer of joinRetryTimers.values()) {
    clearTimeout(timer);
  }
  joinRetryTimers.clear();
  joinRefreshInFlight.clear();
  joinRefreshCompletedAt.clear();
  joinRetryScheduled.clear();
  joinRetryDelayMsOverride = null;
}

/** Test helper: run join retry immediately (0ms) or after fixed delay. */
export function setJoinContextRetryDelayMsForTests(ms: number | null): void {
  joinRetryDelayMsOverride = ms;
}

function readJoinUser(raw: Record<string, unknown>, steamId: string): PlayerJoinUser | undefined {
  const user = raw.user;
  if (!user || typeof user !== 'object') {
    return undefined;
  }
  const source = user as Record<string, unknown>;
  const id =
    (typeof source.steamId === 'string' && source.steamId.trim()) ||
    (typeof source.steam_id === 'string' && source.steam_id.trim()) ||
    steamId;
  const invalidated =
    source.isInvalidated === true ||
    source.is_invalidated === true;
  const name = typeof source.name === 'string' ? source.name.trim() : undefined;
  return { steamId: id, isInvalidated: invalidated, ...(name ? { name } : {}) };
}

function isUserInvalidated(context: PlayerJoinContextResult, user?: PlayerJoinUser): boolean {
  if (!context.ok && context.reason === 'user_invalidated') {
    return true;
  }
  if (user?.isInvalidated === true) {
    return true;
  }
  if (context.session?.ok && isProfileInvalidated(context.session.profile)) {
    return true;
  }
  if (
    context.session !== undefined &&
    !context.session.ok &&
    context.session.reason === 'user_invalidated'
  ) {
    return true;
  }
  return false;
}

function defaultSessionResult(context: PlayerJoinContextResult): HudSessionResult {
  if (context.session !== undefined) {
    return context.session;
  }
  if (!context.ok) {
    if (context.reason === 'user_invalidated') {
      return { ok: false, reason: 'user_invalidated' };
    }
    return { ok: false, reason: context.reason };
  }
  return { ok: false, reason: 'player_not_connected' };
}

function normalizePlayerForCache(result: HudPlayerResult): HudPlayerResult {
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }
  return result;
}

function normalizeSessionForCache(result: HudSessionResult): HudSessionResult {
  if (result.ok && isProfileInvalidated(result.profile)) {
    return { ok: false, reason: 'user_invalidated' };
  }
  return result;
}

export type ApplyPlayerJoinContextOptions = {
  /** When true (worker refresh-user), pub/sub kick fires for ban / not-registered mid-session. */
  publishEnforcement?: boolean;
  /** One-shot retry after player_join when Convex live_players is not ready yet. */
  joinRetry?: boolean;
};

/** Persist ban + HUD caches from unified player join context. */
export async function applyPlayerJoinContext(
  steamId: string,
  context: PlayerJoinContextResult,
  options?: ApplyPlayerJoinContextOptions,
): Promise<{ player: HudPlayerResult; session: HudSessionResult }> {
  const trimmed = steamId.trim();
  const user = context.user ?? readJoinUser(context as unknown as Record<string, unknown>, trimmed);
  const invalidated = isUserInvalidated(context, user);
  const notRegistered = !context.ok && context.reason === 'user_not_found';
  const publish = options?.publishEnforcement === true;
  const wasNotRegistered = publish ? await readUserNotRegistered(trimmed) : false;

  let session = normalizeSessionForCache(defaultSessionResult(context));
  let player = normalizePlayerForCache(playerResultFromSession(session));

  if (invalidated) {
    player = { ok: false, reason: 'user_invalidated' };
    session = { ok: false, reason: 'user_invalidated' };
    await markUserInvalidated(trimmed, { publish });
    await clearUserNotRegistered(trimmed);
  } else if (notRegistered) {
    await markUserNotRegistered(trimmed, { publish });
    await clearUserInvalidated(trimmed);
  } else {
    await clearUserInvalidated(trimmed);
    await clearUserNotRegistered(trimmed);
    if (publish && wasNotRegistered) {
      await publishUserRegisteredWelcome(trimmed);
    }
  }

  const params = { steamId: trimmed };
  await persistPlayerCacheResult(playerRedisKey(buildPlayerCacheKey(params)), player);
  await persistSessionCacheResult(sessionRedisKey(buildSessionCacheKey(params)), session);
  if (player.ok) {
    await bumpPlayerVersion(params);
  }

  const rawProfile = session.ok ? session.profile : player.ok ? player.profile : null;
  const profile = rawProfile ? normalizeHudProfile(rawProfile) : null;
  await syncUserPrefsFromProfile(trimmed, profile, {
    notifyPrefChanges: options?.publishEnforcement === true,
  });
  await syncProfileCosmeticsFromProfile(trimmed, profile, {
    logChanges: options?.publishEnforcement === true,
  });

  console.log(
    `[player-join] steamId=${trimmed} invalidated=${invalidated} notRegistered=${notRegistered} publishEnforcement=${publish} player=${player.ok ? 'ok' : player.reason} session=${session.ok ? 'ok' : session.reason}`,
  );

  return { player, session };
}

async function runPlayerJoinRefresh(
  steamId: string,
  options?: ApplyPlayerJoinContextOptions,
): Promise<HudSessionResult> {
  const context = await fetchPlayerJoinContextImpl(steamId);
  await invalidateHudCachesForSteamId(steamId);
  const { session } = await applyPlayerJoinContext(steamId, context, options);
  if (shouldScheduleJoinRetry(session) && options?.joinRetry !== true) {
    scheduleJoinContextRetry(steamId, options);
  }
  return session;
}

/** Single Convex fetch on player_join or worker refresh-user. */
export async function refreshPlayerJoinFromConvex(
  steamId: string,
  options?: ApplyPlayerJoinContextOptions,
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_') || !isHudConvexConfigured()) {
    return;
  }

  const skipDedupe = options?.publishEnforcement === true || options?.joinRetry === true;

  if (!skipDedupe) {
    const inflight = joinRefreshInFlight.get(trimmed);
    if (inflight) {
      await inflight;
      return;
    }
    const lastCompleted = joinRefreshCompletedAt.get(trimmed);
    if (lastCompleted !== undefined && Date.now() - lastCompleted < JOIN_REFRESH_DEDUPE_MS) {
      return;
    }
  }

  const run = async (): Promise<void> => {
    try {
      await runPlayerJoinRefresh(trimmed, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[player-join] ${process.env.CONVEX_PLAYER_JOIN_QUERY ?? 'workerPlayers:getPlayerJoinContext'} failed for steamId=${trimmed}: ${message}`,
      );
      throw error;
    }
  };

  if (skipDedupe) {
    await run();
    return;
  }

  const task = run().finally(() => {
    joinRefreshInFlight.delete(trimmed);
    joinRefreshCompletedAt.set(trimmed, Date.now());
  });
  joinRefreshInFlight.set(trimmed, task);
  await task;
}
