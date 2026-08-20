import { isHudConvexConfigured } from './hudConvex.js';
import { normalizeHudProfile } from './hudProfile.js';
import { buildSessionCacheKey, sessionRedisKey } from './hudCacheKeys.js';
import { invalidateSessionCache } from './hudSessionCache.js';
import { refreshPlayerJoinFromConvex } from './playerJoinContext.js';
import {
  shouldBypassSessionCacheForPresence,
  shouldRefreshJoinContextForPresence,
  sessionContextServerName,
} from './hudSessionPresence.js';
import {
  fetchHudSessionWithRetry,
  peekSessionCache,
  sessionLeaderboardFingerprint,
} from './lapCompletedHudRefresh.js';
import { HUD_SESSION_TTL_SEC, hudRedisTouch } from './hudRedis.js';
import { shouldFetchHudSession } from './hudSessionFetchPolicy.js';
import { markUserInvalidated } from './hudUserInvalidation.js';
import type { HudSessionResult, HudVersionOk, HudVersionResult } from './hudTypes.js';

export type HudPushReason =
  | 'lap_pb'
  | 'rival_pb'
  | 'battle_elo'
  | 'join_initial'
  | 'worker_cosmetics';

export type PushHudUpdateOptions = {
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
  peekSession?: (steamId: string) => Promise<HudSessionResult | null>;
};

let testHooks: HudPushHubTestHooks | null = null;

export function setHudPushHubTestHooks(hooks: HudPushHubTestHooks | null): void {
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

export function countHudPushListeners(steamId: string): number {
  return connectionsBySteamId.get(steamId.trim())?.size ?? 0;
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

async function peekSessionForPush(steamId: string): Promise<HudSessionResult | null> {
  if (testHooks?.peekSession) {
    return testHooks.peekSession(steamId);
  }
  return peekSessionCache({ steamId });
}

export async function loadHudSessionForPush(
  steamId: string,
  bypassCache = false,
  pushReason?: HudPushReason | string,
): Promise<HudSessionResult> {
  if (!shouldFetchHudSession(pushReason)) {
    const peeked = await peekSessionForPush(steamId);
    return peeked ?? { ok: false, reason: 'player_not_connected' };
  }
  if (bypassCache) {
    await invalidateSessionCache({ steamId });
  }
  if (testHooks?.loadSession) {
    return testHooks.loadSession(steamId, bypassCache);
  }
  return fetchHudSessionWithRetry({ steamId });
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

  const pushReason = options?.pushReason;
  const allowLiveFetch = bypassCache && shouldFetchHudSession(pushReason);

  let session: HudSessionResult;
  if (allowLiveFetch) {
    console.log(
      `[hud-push] fetchHudSession steamId=${steamId} reason=${pushReason ?? 'push'} bypassCache=${bypassCache}`,
    );
    session = await loadHudSessionForPush(steamId, true, pushReason);
  } else {
    const peeked = await peekSessionForPush(steamId);
    if (!peeked) {
      console.warn(
        `[hud-push] peek miss steamId=${steamId} reason=${pushReason ?? 'push'} listeners=${countHudPushListeners(steamId)}`,
      );
      return;
    }
    session = peeked;
  }

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
    ok: true,
    version: session.version,
    lbVersion: session.version,
    playerVersion: Date.now(),
  };
  emitHudVersionToSteamId(steamId, versionForClient);
  emitHudSessionToSteamId(steamId, session);
}

export async function sendInitialHudPushSnapshot(
  conn: HudPushConnection,
  presenceServerName?: string,
): Promise<void> {
  if (presenceServerName?.trim()) {
    const refreshJoin = await shouldRefreshJoinContextForPresence(
      conn.steamId,
      presenceServerName,
    );
    if (refreshJoin) {
      console.log(
        `[hud-push-init] steamId=${conn.steamId} refreshJoinContext=true presenceServer=${presenceServerName.trim()}`,
      );
      await refreshPlayerJoinFromConvex(conn.steamId);
    }
  }
  await pushHudUpdateForSteamId(conn.steamId, false, { pushReason: 'join_initial' });
}

export {
  sessionContextServerName,
  shouldBypassSessionCacheForPresence,
  shouldRefreshJoinContextForPresence,
};
