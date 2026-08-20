import { normalizeHudServerName } from './hudQueryNormalize.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import type { HudSessionOk, HudSessionResult } from './hudTypes.js';

type HudSessionPresenceTestHooks = {
  peekSessionCache?: (steamId: string) => Promise<HudSessionResult | null>;
  /** @deprecated use peekSessionCache */
  getSessionCached?: (steamId: string) => Promise<HudSessionResult>;
};

let testHooks: HudSessionPresenceTestHooks | null = null;

/** Test hook: inject session cache reader for shouldBypassSessionCacheForPresence. */
export function setHudSessionPresenceTestHooks(hooks: HudSessionPresenceTestHooks | null): void {
  testHooks = hooks;
}

async function readSessionCached(steamId: string): Promise<HudSessionResult | null> {
  const id = steamId.trim();
  if (testHooks?.peekSessionCache) {
    return testHooks.peekSessionCache(id);
  }
  if (testHooks?.getSessionCached) {
    return testHooks.getSessionCached(id);
  }
  return peekSessionCache({ steamId: id });
}

function sessionCacheServerMismatch(
  cached: HudSessionOk,
  presenceServerName: string,
): boolean {
  const cachedServer = normalizeHudServerName(cached.context?.server_name ?? '');
  const presence = normalizeHudServerName(presenceServerName);
  if (!cachedServer || !presence) {
    return false;
  }
  return cachedServer !== presence;
}

/** True when WSS/snapshot should call getPlayerJoinContext before peek push. */
export async function shouldRefreshJoinContextForPresence(
  steamId: string,
  presenceServerName: string,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return true;
  }
  return sessionCacheServerMismatch(cached, presenceServerName);
}

/** True when Redis session cache context.server_name differs from live presence server. */
export async function shouldBypassSessionCacheForPresence(
  steamId: string,
  presenceServerName: string,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return false;
  }
  return sessionCacheServerMismatch(cached, presenceServerName);
}

export function sessionContextServerName(session: HudSessionResult): string {
  if (!session.ok) {
    return '';
  }
  return normalizeHudServerName(session.context?.server_name ?? '');
}
