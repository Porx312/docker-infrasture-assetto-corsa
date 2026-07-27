import { fetchHudVersion, isHudConvexConfigured } from './hudConvex.js';
import { normalizeHudProfile } from './hudProfile.js';
import {
  getSessionCached,
  invalidateSessionCache,
  refreshSessionCached,
  sessionLeaderboardFingerprint,
} from './lapCompletedHudRefresh.js';
import { markUserInvalidated } from './hudUserInvalidation.js';
import type { HudSessionResult, HudVersionOk, HudVersionResult } from './hudTypes.js';

export type PushHudUpdateOptions = {
  /** After player_join: emit session/version from Redis cache without extra Convex HUD fetches. */
  preferCachedSession?: boolean;
  /** Skip emit when session rank/rivals fingerprint matches last push to this connection. */
  skipIfSessionUnchanged?: boolean;
};

export type HudSseListener = (event: string, data: unknown) => void;

export type HudSseConnection = {
  steamId: string;
  listener: HudSseListener;
  lastVersionFingerprint: string | null;
  lastSessionLeaderboardFingerprint?: string | null;
};

const connectionsBySteamId = new Map<string, Set<HudSseConnection>>();

type HudSsePushTestHooks = {
  fetchVersion?: (steamId: string) => Promise<HudVersionResult>;
  loadSession?: (steamId: string, bypassCache: boolean) => Promise<HudSessionResult>;
};

let testHooks: HudSsePushTestHooks | null = null;

/** Test hook: inject Convex fetchers for pushHudUpdateForSteamId. */
export function setHudSsePushTestHooks(hooks: HudSsePushTestHooks | null): void {
  testHooks = hooks;
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

export function registerHudSseConnection(conn: HudSseConnection): () => void {
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

export function resetHudSseConnectionsForTests(): void {
  connectionsBySteamId.clear();
}

/** Steam IDs with at least one active HUD SSE connection. */
export function listConnectedHudSteamIds(): string[] {
  return [...connectionsBySteamId.keys()].filter((steamId) => {
    const listeners = connectionsBySteamId.get(steamId);
    return Boolean(listeners && listeners.size > 0);
  });
}

function emitToSteamId(steamId: string, event: string, data: unknown): void {
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners) {
    return;
  }
  for (const conn of listeners) {
    conn.listener(event, data);
  }
}

function emitHudVersionToSteamId(steamId: string, version: HudVersionOk): void {
  const fingerprint = versionFingerprint(version);
  const versionEvent = buildHudVersionEvent(steamId, version);
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners) {
    return;
  }
  for (const conn of listeners) {
    conn.lastVersionFingerprint = fingerprint;
    conn.listener('hud_version', versionEvent);
  }
}

function emitHudSessionToSteamId(steamId: string, session: HudSessionResult): void {
  const sessionEvent = buildHudSessionEvent(steamId, session);
  const sessionFingerprint = session.ok ? sessionLeaderboardFingerprint(session) : '';
  const listeners = connectionsBySteamId.get(steamId);
  if (!listeners) {
    return;
  }
  for (const conn of listeners) {
    if (sessionFingerprint !== '') {
      conn.lastSessionLeaderboardFingerprint = sessionFingerprint;
    }
    conn.listener('hud_session', sessionEvent);
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

export async function loadHudSessionForSse(
  steamId: string,
  bypassCache = false,
): Promise<HudSessionResult> {
  if (bypassCache) {
    await invalidateSessionCache({ steamId });
    return refreshSessionCached({ steamId });
  }
  return getSessionCached({ steamId });
}

/** Event-driven push: hud_version then hud_session for all SSE clients of steamId. */
export async function pushHudUpdateForSteamId(
  steamId: string,
  bypassCache = false,
  options?: PushHudUpdateOptions,
): Promise<void> {
  if (!isHudConvexConfigured()) {
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, 'user_not_found'));
    return;
  }

  if (options?.preferCachedSession && !bypassCache) {
    const session = testHooks?.loadSession
      ? await testHooks.loadSession(steamId, false)
      : await getSessionCached({ steamId });
    if (!session.ok) {
      if (session.reason === 'user_invalidated') {
        await markUserInvalidated(steamId);
      }
      emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, session.reason));
      return;
    }
    if (options?.skipIfSessionUnchanged && shouldSkipSessionPush(steamId, session)) {
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

  const versionResult = testHooks?.fetchVersion
    ? await testHooks.fetchVersion(steamId)
    : await fetchHudVersion({
        steamId,
        now: Date.now(),
      });

  if (!versionResult.ok) {
    const cachedSession = await getSessionCached({ steamId });
    if (!cachedSession.ok && cachedSession.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, versionResult.reason));
    return;
  }

  const session = testHooks?.loadSession
    ? await testHooks.loadSession(steamId, bypassCache)
    : await loadHudSessionForSse(steamId, bypassCache);
  if (!session.ok) {
    if (session.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    emitToSteamId(steamId, 'hud_error', buildHudErrorEvent(steamId, session.reason));
    return;
  }

  if (options?.skipIfSessionUnchanged && shouldSkipSessionPush(steamId, session)) {
    return;
  }

  emitHudVersionToSteamId(steamId, versionResult);
  emitHudSessionToSteamId(steamId, session);
}

export async function sendInitialHudSseSnapshot(conn: HudSseConnection): Promise<void> {
  await pushHudUpdateForSteamId(conn.steamId, false);
}
