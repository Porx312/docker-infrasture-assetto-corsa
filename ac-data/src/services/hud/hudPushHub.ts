import { fetchHudVersion, isHudConvexConfigured } from './hudConvex.js';
import { normalizeHudProfile } from './hudProfile.js';
import { buildSessionCacheKey, sessionRedisKey } from './hudCacheKeys.js';
import { invalidateSessionCache } from './hudSessionCache.js';
import {
  shouldBypassSessionCacheForPresence,
  sessionContextServerName,
} from './hudSessionPresence.js';
import {
  fetchHudSessionWithRetry,
  getSessionCached,
  sessionLeaderboardFingerprint,
} from './lapCompletedHudRefresh.js';
import { HUD_SESSION_TTL_SEC, hudRedisTouch } from './hudRedis.js';
import { markUserInvalidated } from './hudUserInvalidation.js';
import { TRANSIENT_SSE_SESSION_REASONS } from './hudTransientReasons.js';
import type { HudSessionResult, HudVersionOk, HudVersionResult } from './hudTypes.js';

export type HudPushReason =
  | 'lap_pb'
  | 'rival_pb'
  | 'battle_elo'
  | 'join_initial'
  | 'worker_cosmetics';

export type PushHudUpdateOptions = {
  preferCachedSession?: boolean;
  skipIfSessionUnchanged?: boolean;
  pushReason?: HudPushReason;
};

const EVENT_DRIVEN_PUSH_REASONS = new Set<HudPushReason>(['lap_pb', 'rival_pb', 'battle_elo']);

function shouldApplySessionUnchangedSkip(options?: PushHudUpdateOptions): boolean {
  if (options?.pushReason && EVENT_DRIVEN_PUSH_REASONS.has(options.pushReason)) {
    return false;
  }
  return options?.skipIfSessionUnchanged === true;
}

export type HudPushSend = (event: string, data: unknown) => void;

export type HudPushConnection = {
  steamId: string;
  send: HudPushSend;
  lastVersionFingerprint: string | null;
  lastSessionLeaderboardFingerprint?: string | null;
};

const connectionsBySteamId = new Map<string, Set<HudPushConnection>>();

type HudPushHubTestHooks = {
  fetchVersion?: (steamId: string) => Promise<HudVersionResult>;
  loadSession?: (steamId: string, bypassCache: boolean) => Promise<HudSessionResult>;
  getSessionCached?: (steamId: string) => Promise<HudSessionResult>;
};

let testHooks: HudPushHubTestHooks | null = null;

export function setHudPushHubTestHooks(hooks: HudPushHubTestHooks | null): void {
  testHooks = hooks;
}

/** @deprecated use setHudPushHubTestHooks */
export function setHudSsePushTestHooks(hooks: HudPushHubTestHooks | null): void {
  setHudPushHubTestHooks(hooks);
}

export function versionFingerprint(version: HudVersionOk): string {
  return `${version.version}|${version.lbVersion}|${version.playerVersion}`;
}

export function buildHudVersionEvent(steamId: string, version: HudVersionOk): Record<string, unknown> {
  return {
    steamId,
    version: version.version,
    lbVersion: version.lbVersion,
    playerVersion: version.playerVersion,
  };
}

export function buildHudSessionEvent(
  steamId: string,
  session: HudSessionResult,
): Record<string, unknown> {
  if (!session.ok) {
    return { steamId, ok: false, reason: session.reason };
  }

  const profile = session.profile ? normalizeHudProfile(session.profile) : null;
  return {
    steamId,
    ok: true,
    version: session.version,
    context: session.context,
    profile,
  };
}

export function buildHudErrorEvent(steamId: string, reason: string): Record<string, unknown> {
  return { steamId, reason };
}

export function registerHudPushConnection(conn: HudPushConnection): () => void {
  let set = connectionsBySteamId.get(conn.steamId);
  if (!set) {
    set = new Set();
    connectionsBySteamId.set(conn.steamId, set);
  }
  set.add(conn);

  return () => {
    const current = connectionsBySteamId.get(conn.steamId);
    if (!current) {
      return;
    }
    current.delete(conn);
    if (current.size === 0) {
      connectionsBySteamId.delete(conn.steamId);
    }
  };
}

export function resetHudPushConnectionsForTests(): void {
  connectionsBySteamId.clear();
}

/** @deprecated use resetHudPushConnectionsForTests */
export function resetHudSseConnectionsForTests(): void {
  resetHudPushConnectionsForTests();
}

export function countHudPushListeners(steamId: string): number {
  return connectionsBySteamId.get(steamId.trim())?.size ?? 0;
}

/** @deprecated use countHudPushListeners */
export function countHudSseListeners(steamId: string): number {
  return countHudPushListeners(steamId);
}

export function listConnectedHudSteamIds(): string[] {
  return [...connectionsBySteamId.keys()].filter((steamId) => {
    const listeners = connectionsBySteamId.get(steamId);
    return Boolean(listeners && listeners.size > 0);
  });
}

function warnNoPushListeners(steamId: string, event: string): void {
  console.warn(`[hud-push] no listeners steamId=${steamId} event=${event}`);
}

function emitToSteamId(steamId: string, event: string, data: unknown): void {
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners?.size) {
    warnNoPushListeners(steamId, event);
    return;
  }
  for (const conn of listeners) {
    conn.send(event, data);
  }
}

function emitHudVersionToSteamId(steamId: string, version: HudVersionOk): void {
  const fingerprint = versionFingerprint(version);
  const versionEvent = buildHudVersionEvent(steamId, version);
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners?.size) {
    warnNoPushListeners(steamId, 'hud_version');
    return;
  }
  for (const conn of listeners) {
    conn.lastVersionFingerprint = fingerprint;
    conn.send('hud_version', versionEvent);
  }
}

function emitHudSessionToSteamId(steamId: string, session: HudSessionResult): void {
  const sessionEvent = buildHudSessionEvent(steamId, session);
  const sessionFingerprint = session.ok ? sessionLeaderboardFingerprint(session) : '';
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners?.size) {
    warnNoPushListeners(steamId, 'hud_session');
    return;
  }
  if (session.ok) {
    void hudRedisTouch(
      sessionRedisKey(buildSessionCacheKey({ steamId: steamId.trim() })),
      HUD_SESSION_TTL_SEC,
    );
  }
  for (const conn of listeners) {
    if (sessionFingerprint !== '') {
      conn.lastSessionLeaderboardFingerprint = sessionFingerprint;
    }
    conn.send('hud_session', sessionEvent);
  }
}

function shouldSkipSessionPush(steamId: string, session: HudSessionResult): boolean {
  if (!session.ok) {
    return false;
  }
  const fingerprint = sessionLeaderboardFingerprint(session);
  if (fingerprint === '') {
    return false;
  }
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners) {
    return false;
  }
  for (const conn of listeners) {
    if (conn.lastSessionLeaderboardFingerprint !== fingerprint) {
      return false;
    }
  }
  return true;
}

function sessionHasProfile(session: HudSessionResult): boolean {
  return session.ok && session.profile != null;
}

async function resolveSessionForPush(
  steamId: string,
  bypassCache: boolean,
): Promise<HudSessionResult> {
  const session = testHooks?.loadSession
    ? await testHooks.loadSession(steamId, bypassCache)
    : await loadHudSessionForPush(steamId, bypassCache);

  if (sessionHasProfile(session)) {
    return session;
  }
  if (!session.ok && session.reason === 'user_invalidated') {
    return session;
  }

  if (!session.ok && TRANSIENT_SSE_SESSION_REASONS.has(session.reason)) {
    const cached = testHooks?.getSessionCached
      ? await testHooks.getSessionCached(steamId)
      : await getSessionCached({ steamId });
    if (sessionHasProfile(cached)) {
      return cached;
    }
  }

  return session;
}

export async function loadHudSessionForPush(
  steamId: string,
  bypassCache = false,
): Promise<HudSessionResult> {
  if (bypassCache) {
    await invalidateSessionCache({ steamId });
  }
  return fetchHudSessionWithRetry({ steamId });
}

/** @deprecated use loadHudSessionForPush */
export async function loadHudSessionForSse(
  steamId: string,
  bypassCache = false,
): Promise<HudSessionResult> {
  return loadHudSessionForPush(steamId, bypassCache);
}

export async function pushHudUpdateForSteamId(
  steamId: string,
  bypassCache = false,
  options?: PushHudUpdateOptions,
): Promise<void> {
  if (!isHudConvexConfigured()) {
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, 'user_not_found'));
    return;
  }

  if (countHudPushListeners(steamId) === 0) {
    return;
  }

  const cachedSession = testHooks?.getSessionCached
    ? await testHooks.getSessionCached(steamId)
    : await getSessionCached({ steamId });

  if (options?.preferCachedSession && !bypassCache) {
    const session = testHooks?.loadSession
      ? await testHooks.loadSession(steamId, false)
      : cachedSession;
    if (!session.ok) {
      if (session.reason === 'user_invalidated') {
        await markUserInvalidated(steamId);
      }
      emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, session.reason));
      return;
    }
    if (shouldApplySessionUnchangedSkip(options) && shouldSkipSessionPush(steamId, session)) {
      return;
    }
    const versionFromSession: HudVersionOk = {
      ok: true,
      version: session.version,
      lbVersion: session.version,
      playerVersion: Date.now(),
    };
    emitHudVersionToSteamId(steamId, versionFromSession);
    emitHudSessionToSteamId(steamId, session);
    return;
  }

  if (shouldApplySessionUnchangedSkip(options) && cachedSession.ok && shouldSkipSessionPush(steamId, cachedSession)) {
    return;
  }

  const versionResult = testHooks?.fetchVersion
    ? await testHooks.fetchVersion(steamId)
    : await fetchHudVersion({
        steamId,
        now: Date.now(),
      });

  if (!versionResult.ok) {
    if (!cachedSession.ok && cachedSession.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, versionResult.reason));
    return;
  }

  if (!bypassCache && cachedSession.ok && cachedSession.version === versionResult.version) {
    if (shouldApplySessionUnchangedSkip(options) && shouldSkipSessionPush(steamId, cachedSession)) {
      return;
    }
    const versionForClient: HudVersionOk = {
      ...versionResult,
      version: cachedSession.version,
    };
    emitHudVersionToSteamId(steamId, versionForClient);
    emitHudSessionToSteamId(steamId, cachedSession);
    return;
  }

  const session = await resolveSessionForPush(steamId, bypassCache);
  if (!session.ok) {
    if (session.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, session.reason));
    return;
  }

  if (shouldApplySessionUnchangedSkip(options) && shouldSkipSessionPush(steamId, session)) {
    return;
  }

  const versionForClient: HudVersionOk = {
    ...versionResult,
    version: session.version,
  };
  emitHudVersionToSteamId(steamId, versionForClient);
  emitHudSessionToSteamId(steamId, session);
}

export async function sendInitialHudPushSnapshot(
  conn: HudPushConnection,
  presenceServerName?: string,
): Promise<void> {
  let bypass = false;
  if (presenceServerName?.trim()) {
    bypass = await shouldBypassSessionCacheForPresence(conn.steamId, presenceServerName);
    if (bypass) {
      console.log(
        `[hud-push-init] steamId=${conn.steamId} bypassCache=true presenceServer=${presenceServerName.trim()}`,
      );
    }
  }
  if (bypass) {
    await pushHudUpdateForSteamId(conn.steamId, true, { pushReason: 'join_initial' });
    return;
  }
  await pushHudUpdateForSteamId(conn.steamId, false, {
    preferCachedSession: true,
    pushReason: 'join_initial',
  });
}

/** @deprecated use sendInitialHudPushSnapshot */
export async function sendInitialHudSseSnapshot(
  conn: HudPushConnection,
  presenceServerName?: string,
): Promise<void> {
  return sendInitialHudPushSnapshot(conn, presenceServerName);
}

export { sessionContextServerName, shouldBypassSessionCacheForPresence };
