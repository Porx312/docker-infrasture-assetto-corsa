import { presenceRedisKey } from '@projectd/ac-data-shared/services/hud/hudCacheKeys.js';
import { stripCspTrackPrefix } from '@projectd/ac-data-shared/mods/cspTrack.js';
import { normalizeTrackConfigForIni } from '@projectd/ac-data-shared/controller/trackConfig.js';
import { pickCarModelId } from './hudCarModel.js';
import { lookupManagedServer } from './hudManagedServers.js';
import { normalizeHudServerName } from '@projectd/ac-data-shared/services/hud/hudQueryNormalize.js';
import { hudRedisGet } from '@projectd/ac-data-shared/services/hud/hudRedis.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import type { HudSessionOk, HudSessionResult, PlayerPresenceRecord } from '@projectd/ac-data-shared/services/hud/hudTypes.js';

export type PresenceCompareHints = {
  carModel?: string;
  track?: string;
  trackConfig?: string;
};

type HudSessionPresenceTestHooks = {
  peekSessionCache?: (steamId: string) => Promise<HudSessionResult | null>;
  /** @deprecated use peekSessionCache */
  getSessionCached?: (steamId: string) => Promise<HudSessionResult>;
  readPresenceCarModel?: (steamId: string) => Promise<string>;
  readPresenceTrack?: (
    steamId: string,
  ) => Promise<{ track: string; trackConfig: string }>;
};

let testHooks: HudSessionPresenceTestHooks | null = null;

/** Test hook: inject session cache reader for shouldBypassSessionCacheForPresence. */
export function setHudSessionPresenceTestHooks(hooks: HudSessionPresenceTestHooks | null): void {
  testHooks = hooks;
}

export function resolvePresenceCompareHints(
  carOrHints?: string | PresenceCompareHints,
): PresenceCompareHints {
  if (carOrHints == null) {
    return {};
  }
  if (typeof carOrHints === 'string') {
    return { carModel: carOrHints };
  }
  return carOrHints;
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

async function readPresenceTrackFields(
  steamId: string,
): Promise<{ track: string; trackConfig: string }> {
  if (testHooks?.readPresenceTrack) {
    return testHooks.readPresenceTrack(steamId);
  }
  const raw = await hudRedisGet(presenceRedisKey(steamId.trim()));
  if (!raw) {
    return { track: '', trackConfig: '' };
  }
  try {
    const record = JSON.parse(raw) as PlayerPresenceRecord;
    return {
      track: typeof record.track === 'string' ? record.track : '',
      trackConfig: typeof record.trackConfig === 'string' ? record.trackConfig : '',
    };
  } catch {
    return { track: '', trackConfig: '' };
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

export function normalizeHudTrackId(track: string): string {
  return stripCspTrackPrefix(track || '').toLowerCase();
}

export function normalizeHudLayoutId(layout: string | undefined | null): string {
  return (normalizeTrackConfigForIni(layout) ?? '').toLowerCase();
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

/** True when both sides have a track id and they differ (CSP-stripped); layout empty is compatible. */
export function sessionCacheTrackMismatch(
  cached: HudSessionOk,
  presenceTrack: string,
  presenceTrackConfig?: string,
): boolean {
  const cachedTrack = normalizeHudTrackId(cached.context?.track_id ?? '');
  const liveTrack = normalizeHudTrackId(presenceTrack);
  if (!cachedTrack || !liveTrack) {
    return false;
  }
  if (cachedTrack !== liveTrack) {
    return true;
  }
  const cachedLayout = normalizeHudLayoutId(cached.context?.layout_id);
  const liveLayout = normalizeHudLayoutId(presenceTrackConfig);
  if (!cachedLayout || !liveLayout) {
    return false;
  }
  return cachedLayout !== liveLayout;
}

/**
 * Patch session context track/layout from live presence so HUD context_guard does not thrash
 * when Convex/session cache lags a server track rotation.
 */
export function overlaySessionContextFromPresence(
  session: HudSessionOk,
  presence: { track?: string; trackConfig?: string },
): HudSessionOk {
  const liveTrackRaw = typeof presence.track === 'string' ? presence.track.trim() : '';
  const liveTrack = stripCspTrackPrefix(liveTrackRaw);
  if (!liveTrack) {
    return session;
  }
  const liveLayout = normalizeTrackConfigForIni(presence.trackConfig) ?? '';
  const cachedTrack = normalizeHudTrackId(session.context.track_id);
  const nextTrack = normalizeHudTrackId(liveTrack);
  const cachedLayout = normalizeHudLayoutId(session.context.layout_id);
  const nextLayout = normalizeHudLayoutId(liveLayout);
  if (cachedTrack === nextTrack && (cachedLayout === nextLayout || !cachedLayout || !nextLayout)) {
    return session;
  }
  return {
    ...session,
    context: {
      ...session.context,
      track_id: liveTrack,
      layout_id: liveLayout,
    },
  };
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
  if (cachedServer === presence) {
    return false;
  }
  const managedCached = lookupManagedServer(cachedServer);
  const managedPresence = lookupManagedServer(presence);
  if (
    managedCached &&
    managedPresence &&
    managedCached.folderSlug === managedPresence.folderSlug
  ) {
    return false;
  }
  return true;
}

function sessionCachePresenceMismatch(
  cached: HudSessionOk,
  presenceServerName: string,
  hints: PresenceCompareHints,
): boolean {
  if (sessionCacheServerMismatch(cached, presenceServerName)) {
    return true;
  }
  if (hints.track !== undefined && sessionCacheTrackMismatch(cached, hints.track, hints.trackConfig)) {
    return true;
  }
  if (hints.carModel !== undefined) {
    return sessionCacheCarMismatch(cached, hints.carModel);
  }
  return false;
}

async function resolveLiveHints(
  steamId: string,
  carOrHints?: string | PresenceCompareHints,
): Promise<PresenceCompareHints> {
  const hints = resolvePresenceCompareHints(carOrHints);
  let track = hints.track;
  let trackConfig = hints.trackConfig;
  let carModel = hints.carModel;

  if (track === undefined || carModel === undefined) {
    const fromRedis = await readPresenceTrackFields(steamId);
    if (track === undefined) {
      track = fromRedis.track;
      trackConfig = trackConfig ?? fromRedis.trackConfig;
    }
    if (carModel === undefined) {
      carModel = (await readPresenceCarModel(steamId)) || undefined;
    }
  }

  return { carModel, track, trackConfig };
}

/** True when WSS/snapshot should call getPlayerJoinContext before peek push. */
export async function shouldRefreshJoinContextForPresence(
  steamId: string,
  presenceServerName: string,
  carOrHints?: string | PresenceCompareHints,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return true;
  }
  const hints = await resolveLiveHints(steamId, carOrHints);
  if (sessionCachePresenceMismatch(cached, presenceServerName, hints)) {
    return true;
  }
  if (hints.carModel && sessionCacheCarMismatch(cached, hints.carModel)) {
    return true;
  }
  if (
    hints.track &&
    sessionCacheTrackMismatch(cached, hints.track, hints.trackConfig)
  ) {
    return true;
  }
  return false;
}

/** True when Redis session cache context differs from live presence (server/car/track). */
export async function shouldBypassSessionCacheForPresence(
  steamId: string,
  presenceServerName: string,
  carOrHints?: string | PresenceCompareHints,
): Promise<boolean> {
  const cached = await readSessionCached(steamId);
  if (!cached?.ok) {
    return false;
  }
  const hints = await resolveLiveHints(steamId, carOrHints);
  if (sessionCachePresenceMismatch(cached, presenceServerName, hints)) {
    return true;
  }
  if (hints.carModel && sessionCacheCarMismatch(cached, hints.carModel)) {
    return true;
  }
  if (
    hints.track &&
    sessionCacheTrackMismatch(cached, hints.track, hints.trackConfig)
  ) {
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
