import { presenceRedisKey } from './hudCacheKeys.js';
import { pickCarModelId } from './hudCarModel.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';
import { hudRedisGet } from './hudRedis.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import type { HudSessionOk, HudSessionResult, PlayerPresenceRecord } from './hudTypes.js';

type HudSessionPresenceTestHooks = {
  peekSessionCache?: (steamId: string) => Promise<HudSessionResult | null>;
  /** @deprecated use peekSessionCache */
  getSessionCached?: (steamId: string) => Promise<HudSessionResult>;
  readPresenceCarModel?: (steamId: string) => Promise<string>;
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

async function readPresenceCarModel(steamId: string): Promise<string> {
  if (testHooks?.readPresenceCarModel) {
    return testHooks.readPresenceCarModel(steamId);
  }
  const raw = await hudRedisGet(presenceRedisKey(steamId.trim()));
  if (!raw) {
    return '';
  }
  try {
    const record = JSON.parse(raw) as PlayerPresenceRecord;
    return typeof record.carModel === 'string' ? record.carModel : '';
  } catch {
    return '';
  }
}

function sessionCachedCarId(cached: HudSessionOk): string {
  return (
    pickCarModelId(cached.context?.car_id, [cached.profile?.car_id]) ??
    cached.context?.car_id?.trim() ??
    cached.profile?.car_id?.trim() ??
    ''
  );
}

export function sessionCacheCarMismatch(cached: HudSessionOk, presenceCarModel: string): boolean {
  const cachedCar = sessionCachedCarId(cached);
  const presenceCar =
    pickCarModelId(presenceCarModel) ?? presenceCarModel.trim();
  if (!cachedCar || !presenceCar) {
    return false;
  }
  return cachedCar !== presenceCar;
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

function sessionCachePresenceMismatch(
  cached: HudSessionOk,
  presenceServerName: string,
  presenceCarModel?: string,
): boolean {
  if (sessionCacheServerMismatch(cached, presenceServerName)) {
    return true;
  }
  if (presenceCarModel !== undefined) {
    return sessionCacheCarMismatch(cached, presenceCarModel);
  }
  return false;
}

/** True when WSS/snapshot should call getPlayerJoinContext before peek push. */
export async function shouldRefreshJoinContextForPresence(
  steamId: string,
  presenceServerName: string,
  presenceCarModel?: string,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return true;
  }
  if (sessionCachePresenceMismatch(cached, presenceServerName, presenceCarModel)) {
    return true;
  }
  const liveCar = presenceCarModel ?? (await readPresenceCarModel(steamId));
  if (liveCar && sessionCacheCarMismatch(cached, liveCar)) {
    return true;
  }
  return false;
}

/** True when Redis session cache context.server_name differs from live presence server. */
export async function shouldBypassSessionCacheForPresence(
  steamId: string,
  presenceServerName: string,
  presenceCarModel?: string,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return false;
  }
  if (sessionCachePresenceMismatch(cached, presenceServerName, presenceCarModel)) {
    return true;
  }
  const liveCar = presenceCarModel ?? (await readPresenceCarModel(steamId));
  if (liveCar && sessionCacheCarMismatch(cached, liveCar)) {
    return true;
  }
  return false;
}

/** True when join dedupe should be bypassed (cached session car differs from live presence). */
export async function shouldBypassJoinRefreshDedupe(
  steamId: string,
  presenceCarModel?: string,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return false;
  }
  const liveCar = presenceCarModel ?? (await readPresenceCarModel(steamId));
  if (!liveCar) {
    return false;
  }
  return sessionCacheCarMismatch(cached, liveCar);
}

export function sessionContextServerName(session: HudSessionResult): string {
  if (!session.ok) {
    return '';
  }
  return normalizeHudServerName(session.context?.server_name ?? '');
}
