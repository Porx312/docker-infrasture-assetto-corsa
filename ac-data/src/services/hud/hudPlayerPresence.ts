import {
  presenceRedisKey,
  presenceRosterRedisKey,
} from './hudCacheKeys.js';
import {
  lookupManagedServer,
} from './hudManagedServers.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';
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

function parsePlayerRow(raw: unknown): { steamId: string; carModel: string } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const steamId = typeof row.steamId === 'string' ? row.steamId.trim() : '';
  if (!steamId || steamId.startsWith('unknown_')) {
    return null;
  }
  const carModel = typeof row.carModel === 'string' ? row.carModel.trim() : '';
  return { steamId, carModel };
}

function parseEventData(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload.data ?? {}) as Record<string, unknown>;
}

function buildPresenceRecord(
  serverName: string,
  data: Record<string, unknown>,
  steamId: string,
  carModelOverride?: string,
): PlayerPresenceRecord {
  const track = typeof data.trackName === 'string' ? data.trackName : '';
  const trackConfig = typeof data.trackConfig === 'string' ? data.trackConfig : '';
  const carModel =
    carModelOverride ??
    (typeof data.carModel === 'string' ? data.carModel.trim() : '');
  return {
    serverName: normalizeHudServerName(serverName),
    track,
    trackConfig,
    carModel,
    updatedAt: Date.now(),
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
  await hudRedisSet(presenceRedisKey(steamId), JSON.stringify(record), ttlSec);
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
  };
  await writePresence(presence.steamId, record);
  registerBattleSsePresence({ ...presence, updatedAt: record.updatedAt });
}

async function readPresenceRecord(steamId: string): Promise<PlayerPresenceRecord | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const raw = await hudRedisGet(presenceRedisKey(steamId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PlayerPresenceRecord;
  } catch {
    return null;
  }
}

async function readRoster(normalizedServerName: string): Promise<string[]> {
  if (!isHudRedisConfigured()) {
    return [];
  }
  const raw = await hudRedisGet(presenceRosterRedisKey(normalizedServerName));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

async function writeRoster(normalizedServerName: string, steamIds: string[]): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  await hudRedisSet(
    presenceRosterRedisKey(normalizedServerName),
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
    serverType: managed.type,
    folderSlug: managed.folderSlug,
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
  const players = Array.isArray(data.players) ? data.players : [];
  const nextSteamIds: string[] = [];

  for (const row of players) {
    const player = parsePlayerRow(row);
    if (!player) {
      continue;
    }
    nextSteamIds.push(player.steamId);
    const record = buildPresenceRecord(serverName, data, player.steamId, player.carModel);
    await writePresence(player.steamId, record);
  }

  const previousSteamIds = await readRoster(normalizedServer);
  const mergedRoster = [...new Set([...previousSteamIds, ...nextSteamIds])];
  await writeRoster(normalizedServer, mergedRoster);
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
  const carModel = typeof data.carModel === 'string' ? data.carModel.trim() : '';
  const record = buildPresenceRecord(serverName, data, steamId, carModel);
  await writePresence(steamId, record, HUD_PRESENCE_JOIN_TTL_SEC);

  const roster = await readRoster(normalizedServer);
  if (!roster.includes(steamId)) {
    roster.push(steamId);
    await writeRoster(normalizedServer, roster);
  }
}

export async function noteHudPlayerLeave(payload: Record<string, unknown>): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = parseEventData(payload);
  const steamId = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  if (!steamId) {
    return;
  }

  await hudRedisDel(presenceRedisKey(steamId));

  if (serverName) {
    const normalizedServer = normalizeHudServerName(serverName);
    const roster = await readRoster(normalizedServer);
    const next = roster.filter((id) => id !== steamId);
    if (next.length === 0) {
      await hudRedisDel(presenceRosterRedisKey(normalizedServer));
    } else {
      await writeRoster(normalizedServer, next);
    }
  }
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
