import {
  parseHudPresenceRecordJson,
  serializeHudPresenceRecord,
} from '@projectd/ac-data-shared/services/hud/hudPresenceRecord.js';
import {
  presenceRedisKey,
  presenceRosterRedisKey,
} from './hudCacheKeys.js';
import { invalidateSessionCache } from './hudSessionCache.js';
import { lookupManagedServer } from './hudManagedServers.js';
import { normalizeHudServerName } from '@projectd/ac-data-shared/services/hud/hudQueryNormalize.js';
import { pickCarModelId, readCarModelFromEventData } from './hudCarModel.js';
import {
  HUD_PRESENCE_JOIN_TTL_SEC,
  HUD_PRESENCE_TTL_SEC,
  hudRedisDel,
  hudRedisGet,
  hudRedisSet,
  hudRedisTouch,
  isHudRedisConfigured,
} from './hudRedis.js';
import type {
  PlayerPresenceRecord,
  ResolvePlayerPresenceResult,
  ResolvedPlayerPresence,
} from './hudTypes.js';

function parsePlayerRow(raw: unknown): { steamId: string; carModel: string; name?: string } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const steamId = typeof row.steamId === 'string' ? row.steamId.trim() : '';
  if (!steamId || steamId.startsWith('unknown_')) {
    return null;
  }
  const carModel =
    pickCarModelId(typeof row.carModel === 'string' ? row.carModel : undefined, [
      typeof row.car_id === 'string' ? row.car_id : undefined,
      typeof row.carId === 'string' ? row.carId : undefined,
    ]) ??
    ((typeof row.car_id === 'string' ? row.car_id.trim() : '') ||
      (typeof row.carId === 'string' ? row.carId.trim() : '') ||
      (typeof row.carModel === 'string' ? row.carModel.trim() : ''));
  const nameRaw =
    (typeof row.name === 'string' ? row.name : undefined) ??
    (typeof row.driverName === 'string' ? row.driverName : undefined) ??
    (typeof row.playerName === 'string' ? row.playerName : undefined);
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined;
  return { steamId, carModel, name };
}

function readPlayerNameFromEventData(data: Record<string, unknown>): string | undefined {
  const nameRaw =
    (typeof data.name === 'string' ? data.name : undefined) ??
    (typeof data.driverName === 'string' ? data.driverName : undefined) ??
    (typeof data.playerName === 'string' ? data.playerName : undefined);
  return typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined;
}

function parseEventData(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.data ?? {}) as Record<string, unknown>;
}

/** Prefer event envelope instanceId so shared Redis consumer group cannot mis-route. */
export function resolveInstanceId(payload: Record<string, unknown>): string | undefined {
  const fromPayload =
    typeof payload.instanceId === 'string' ? payload.instanceId.trim() : '';
  if (fromPayload) {
    return fromPayload;
  }
  const fromEnv = (process.env.AC_INSTANCE_ID || '').trim();
  return fromEnv || undefined;
}

function resolveFolderSlug(serverName: string): string | undefined {
  const managed = lookupManagedServer(serverName);
  return managed?.folderSlug;
}

function buildPresenceRecord(
  serverName: string,
  data: Record<string, unknown>,
  steamId: string,
  carModelOverride?: string,
  routing?: { instanceId?: string; folderSlug?: string; name?: string },
): PlayerPresenceRecord {
  const track = typeof data.trackName === 'string' ? data.trackName : '';
  const trackConfig = typeof data.trackConfig === 'string' ? data.trackConfig : '';
  const carModel = readCarModelFromEventData(data, carModelOverride);
  const normalizedServer = normalizeHudServerName(serverName);
  const folderSlug = routing?.folderSlug ?? resolveFolderSlug(serverName);
  const name = routing?.name ?? readPlayerNameFromEventData(data);
  return {
    serverName: normalizedServer,
    track,
    trackConfig,
    carModel,
    updatedAt: Date.now(),
    name,
    instanceId: routing?.instanceId,
    folderSlug,
  };
}

function mergeRoutingFields(
  prior: PlayerPresenceRecord | null,
  next: PlayerPresenceRecord,
): PlayerPresenceRecord {
  if (!prior) {
    return next;
  }
  return {
    ...next,
    name: next.name ?? prior.name,
    instanceId: next.instanceId ?? prior.instanceId,
    folderSlug: next.folderSlug ?? prior.folderSlug,
  };
}

async function writePresence(
  steamId: string,
  record: PlayerPresenceRecord,
  ttlSec: number = HUD_PRESENCE_TTL_SEC,
): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  await hudRedisSet(presenceRedisKey(steamId), serializeHudPresenceRecord(record), ttlSec);
}

/** In-memory fallback while battle SSE is connected (Redis key may expire mid-session). */
const activeBattleSseBySteamId = new Map<string, ResolvedPlayerPresence>();

export function registerBattleSsePresence(presence: ResolvedPlayerPresence): void {
  activeBattleSseBySteamId.set(presence.steamId, presence);
}

export function unregisterBattleSsePresence(steamId: string): void {
  activeBattleSseBySteamId.delete(steamId.trim());
}

function battleSsePresenceRecord(steamId: string): PlayerPresenceRecord | null {
  const presence = activeBattleSseBySteamId.get(steamId.trim());
  if (!presence) {
    return null;
  }
  return {
    serverName: presence.serverName,
    track: presence.track,
    trackConfig: presence.trackConfig,
    carModel: presence.carModel,
    updatedAt: presence.updatedAt,
    name: presence.name,
    instanceId: presence.instanceId,
    folderSlug: presence.folderSlug,
  };
}

export async function renewPlayerPresence(steamId: string): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  await hudRedisTouch(presenceRedisKey(steamId.trim()), HUD_PRESENCE_TTL_SEC);
}

export async function refreshPlayerPresence(presence: ResolvedPlayerPresence): Promise<void> {
  const record: PlayerPresenceRecord = {
    serverName: presence.serverName,
    track: presence.track,
    trackConfig: presence.trackConfig,
    carModel: presence.carModel,
    updatedAt: Date.now(),
    name: presence.name,
    instanceId: presence.instanceId,
    folderSlug: presence.folderSlug,
  };
  await writePresence(presence.steamId, record, HUD_PRESENCE_JOIN_TTL_SEC);
  registerBattleSsePresence({ ...presence, updatedAt: record.updatedAt });
}

export async function readPlayerPresenceRecord(
  steamId: string,
): Promise<PlayerPresenceRecord | null> {
  const trimmed = steamId.trim();
  const redisRecord = await readPresenceRecord(trimmed);
  return redisRecord ?? battleSsePresenceRecord(trimmed);
}

export async function readServerPresenceRoster(
  normalizedServerName: string,
  instanceId?: string | null,
): Promise<string[]> {
  return readRoster(normalizedServerName.trim(), instanceId);
}

async function readPresenceRecord(steamId: string): Promise<PlayerPresenceRecord | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const raw = await hudRedisGet(presenceRedisKey(steamId));
  if (!raw) {
    return null;
  }
  return parseHudPresenceRecordJson(raw);
}

/** Read live HUD presence from Redis (for leave race / session presence checks). */
export async function readHudPlayerPresenceRecord(
  steamId: string,
): Promise<PlayerPresenceRecord | null> {
  return readPresenceRecord(steamId.trim());
}

function normalizePresenceCarModel(carModel: string): string {
  return pickCarModelId(carModel) ?? carModel.trim();
}

function presenceCarChanged(prior: PlayerPresenceRecord, nextCarModel: string): boolean {
  const priorCar = normalizePresenceCarModel(prior.carModel);
  const nextCar = normalizePresenceCarModel(nextCarModel);
  if (!priorCar || !nextCar) {
    return false;
  }
  return priorCar !== nextCar;
}

type HudPlayerPresenceTestHooks = {
  onSessionCacheInvalidated?: (steamId: string, reason: 'server' | 'car') => void;
};

let presenceTestHooks: HudPlayerPresenceTestHooks | null = null;

/** Test hook: observe session cache invalidation on join. */
export function setHudPlayerPresenceTestHooks(hooks: HudPlayerPresenceTestHooks | null): void {
  presenceTestHooks = hooks;
}

async function readRoster(
  normalizedServerName: string,
  instanceId?: string | null,
): Promise<string[]> {
  if (!isHudRedisConfigured()) {
    return [];
  }
  const scopedKey = presenceRosterRedisKey(normalizedServerName, instanceId);
  const raw = await hudRedisGet(scopedKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    } catch {
      return [];
    }
  }
  // Legacy unscoped key (pre instanceId scoping) — only when instanceId is set.
  if (instanceId) {
    const legacy = await hudRedisGet(presenceRosterRedisKey(normalizedServerName));
    if (!legacy) {
      return [];
    }
    try {
      const parsed = JSON.parse(legacy) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function writeRoster(
  normalizedServerName: string,
  steamIds: string[],
  instanceId?: string | null,
): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  await hudRedisSet(
    presenceRosterRedisKey(normalizedServerName, instanceId),
    JSON.stringify(steamIds),
    HUD_PRESENCE_TTL_SEC,
  );
}

export function validateResolvedPresence(
  steamId: string,
  record: PlayerPresenceRecord | null,
): ResolvePlayerPresenceResult {
  const trimmedSteamId = steamId.trim();
  if (!trimmedSteamId) {
    return { ok: false, reason: 'player_not_connected' };
  }

  if (!record) {
    return { ok: false, reason: 'player_not_connected' };
  }

  const managed = lookupManagedServer(record.serverName);
  if (!managed) {
    return { ok: false, reason: 'not_managed_server' };
  }

  const presence: ResolvedPlayerPresence = {
    steamId: trimmedSteamId,
    serverName: record.serverName,
    track: record.track,
    trackConfig: record.trackConfig,
    carModel: record.carModel,
    updatedAt: record.updatedAt,
    name: record.name,
    instanceId: record.instanceId,
    serverType: managed.type,
    folderSlug: record.folderSlug ?? managed.folderSlug,
  };
  return { ok: true, presence };
}

export async function resolvePlayerPresence(
  steamId: string,
): Promise<ResolvePlayerPresenceResult> {
  const trimmedSteamId = steamId.trim();
  const redisRecord = await readPresenceRecord(trimmedSteamId);
  const record = redisRecord ?? battleSsePresenceRecord(trimmedSteamId);

  const result = validateResolvedPresence(trimmedSteamId, record);
  if (result.ok && redisRecord) {
    await renewPlayerPresence(trimmedSteamId);
  }
  return result;
}

export async function noteHudServerStatus(payload: Record<string, unknown>): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  if (!serverName) {
    return;
  }

  const data = parseEventData(payload);
  const normalizedServer = normalizeHudServerName(serverName);
  const instanceId = resolveInstanceId(payload);
  const folderSlug = resolveFolderSlug(serverName);
  const players = Array.isArray(data.players) ? data.players : [];
  const nextSteamIds: string[] = [];

  for (const row of players) {
    const player = parsePlayerRow(row);
    if (!player) {
      continue;
    }
    nextSteamIds.push(player.steamId);
    const prior = await readPresenceRecord(player.steamId);
    const record = mergeRoutingFields(
      prior,
      buildPresenceRecord(serverName, data, player.steamId, player.carModel, {
        instanceId,
        folderSlug,
        name: player.name,
      }),
    );
    await writePresence(player.steamId, record);
  }

  // Replace roster from server_status (authoritative lobby snapshot).
  const uniqueSteamIds = [...new Set(nextSteamIds)];
  if (uniqueSteamIds.length === 0) {
    await hudRedisDel(presenceRosterRedisKey(normalizedServer, instanceId));
    if (instanceId) {
      await hudRedisDel(presenceRosterRedisKey(normalizedServer));
    }
  } else {
    await writeRoster(normalizedServer, uniqueSteamIds, instanceId);
  }
}

export async function noteHudPlayerJoin(payload: Record<string, unknown>): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = parseEventData(payload);
  const steamId = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  if (!serverName || !steamId || steamId.startsWith('unknown_')) {
    return;
  }

  const normalizedServer = normalizeHudServerName(serverName);
  const carModel = readCarModelFromEventData(data);
  const prior = await readPresenceRecord(steamId);
  if (prior) {
    const priorServer = normalizeHudServerName(prior.serverName);
    if (priorServer && priorServer !== normalizedServer) {
      await invalidateSessionCache({ steamId });
      presenceTestHooks?.onSessionCacheInvalidated?.(steamId, 'server');
      console.log(
        `[hud-presence] steamId=${steamId} server changed ${priorServer} -> ${normalizedServer} session cache invalidated`,
      );
    } else if (presenceCarChanged(prior, carModel)) {
      await invalidateSessionCache({ steamId });
      presenceTestHooks?.onSessionCacheInvalidated?.(steamId, 'car');
      const priorCar = normalizePresenceCarModel(prior.carModel);
      const nextCar = normalizePresenceCarModel(carModel);
      console.log(
        `[hud-presence] steamId=${steamId} car changed ${priorCar} -> ${nextCar} session cache invalidated`,
      );
      const { clearJoinRefreshDedupe } = await import('./playerJoinContext.js');
      clearJoinRefreshDedupe(steamId);
    }
  }
  const instanceId = resolveInstanceId(payload);
  const folderSlug = resolveFolderSlug(serverName);
  const name = readPlayerNameFromEventData(data);
  const record = mergeRoutingFields(
    prior,
    buildPresenceRecord(serverName, data, steamId, carModel, { instanceId, folderSlug, name }),
  );
  await writePresence(steamId, record, HUD_PRESENCE_JOIN_TTL_SEC);

  const roster = await readRoster(normalizedServer, instanceId);
  if (!roster.includes(steamId)) {
    roster.push(steamId);
    await writeRoster(normalizedServer, roster, instanceId);
  }
}

export async function noteHudPlayerLeave(payload: Record<string, unknown>): Promise<boolean> {
  if (!isHudRedisConfigured()) {
    return false;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = parseEventData(payload);
  const steamId = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  if (!steamId) {
    return false;
  }

  const leaveCarModel = readCarModelFromEventData(data);
  const current = await readPresenceRecord(steamId);
  if (current && presenceCarChanged(current, leaveCarModel)) {
    return false;
  }

  await hudRedisDel(presenceRedisKey(steamId));

  if (serverName) {
    const normalizedServer = normalizeHudServerName(serverName);
    const instanceId = resolveInstanceId(payload) ?? current?.instanceId;
    const roster = await readRoster(normalizedServer, instanceId);
    const next = roster.filter((id) => id !== steamId);
    if (next.length === 0) {
      await hudRedisDel(presenceRosterRedisKey(normalizedServer, instanceId));
      if (instanceId) {
        await hudRedisDel(presenceRosterRedisKey(normalizedServer));
      }
    } else {
      await writeRoster(normalizedServer, next, instanceId);
    }
  }

  return true;
}

/** Test helper: reset in-memory battle SSE presence map. */
export function resetBattleSsePresenceForTests(): void {
  activeBattleSseBySteamId.clear();
}

/** Test helper: build presence record from event fields. */
export function buildPresenceRecordForTests(
  serverName: string,
  data: Record<string, unknown>,
  steamId: string,
  carModel?: string,
): PlayerPresenceRecord {
  return buildPresenceRecord(serverName, data, steamId, carModel);
}
