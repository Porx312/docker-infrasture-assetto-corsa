import { hudRedisGet, hudRedisSet, isHudRedisConfigured } from '../hud/hudRedis.js';
import {
  instanceModsCarsKey,
  instanceModsMetaKey,
  instanceModsTracksKey,
  MODS_INVENTORY_TTL_SEC,
} from './redisKeys.js';

export type ModCarInventoryItem = {
  carModel: string;
  displayName?: string;
  skins: string[];
};

export type ModTrackInventoryItem = {
  trackSlug: string;
  configs: string[];
};

export type ModsInventorySnapshot = {
  cars: ModCarInventoryItem[];
  tracks: ModTrackInventoryItem[];
  etag?: string;
  scannedAt?: number;
};

export type ModsInventoryMeta = {
  etag: string;
  scannedAt: number;
  carCount: number;
  trackCount: number;
};

function normalizeInstanceId(instanceId: string): string {
  return instanceId.trim();
}

export async function storeModsInventory(
  instanceId: string,
  snapshot: ModsInventorySnapshot,
): Promise<ModsInventoryMeta> {
  if (!isHudRedisConfigured()) {
    throw new Error('redis_unavailable');
  }
  const id = normalizeInstanceId(instanceId);
  if (!id) {
    throw new Error('instanceId_required');
  }

  const scannedAt = snapshot.scannedAt ?? Date.now();
  const etag =
    (typeof snapshot.etag === 'string' && snapshot.etag.trim()) ||
    `scan-${scannedAt}-${snapshot.cars.length}-${snapshot.tracks.length}`;

  const cars = Array.isArray(snapshot.cars) ? snapshot.cars : [];
  const tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];

  await hudRedisSet(instanceModsCarsKey(id), JSON.stringify(cars), MODS_INVENTORY_TTL_SEC);
  await hudRedisSet(instanceModsTracksKey(id), JSON.stringify(tracks), MODS_INVENTORY_TTL_SEC);
  const meta: ModsInventoryMeta = {
    etag,
    scannedAt,
    carCount: cars.length,
    trackCount: tracks.length,
  };
  await hudRedisSet(instanceModsMetaKey(id), JSON.stringify(meta), MODS_INVENTORY_TTL_SEC);
  return meta;
}

async function readJsonArray<T>(key: string): Promise<T[] | null> {
  const raw = await hudRedisGet(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export async function getModsCars(instanceId: string): Promise<{
  ok: true;
  instanceId: string;
  cars: ModCarInventoryItem[];
  meta: ModsInventoryMeta | null;
} | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const id = normalizeInstanceId(instanceId);
  const cars = (await readJsonArray<ModCarInventoryItem>(instanceModsCarsKey(id))) ?? [];
  const metaRaw = await hudRedisGet(instanceModsMetaKey(id));
  let meta: ModsInventoryMeta | null = null;
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw) as ModsInventoryMeta;
    } catch {
      meta = null;
    }
  }
  return { ok: true, instanceId: id, cars, meta };
}

export async function getModsTracks(instanceId: string): Promise<{
  ok: true;
  instanceId: string;
  tracks: ModTrackInventoryItem[];
  meta: ModsInventoryMeta | null;
} | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const id = normalizeInstanceId(instanceId);
  const tracks = (await readJsonArray<ModTrackInventoryItem>(instanceModsTracksKey(id))) ?? [];
  const metaRaw = await hudRedisGet(instanceModsMetaKey(id));
  let meta: ModsInventoryMeta | null = null;
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw) as ModsInventoryMeta;
    } catch {
      meta = null;
    }
  }
  return { ok: true, instanceId: id, tracks, meta };
}

export async function loadModsSnapshotForValidation(
  instanceId: string,
): Promise<{ carModels: Set<string>; trackSlugs: Set<string> } | null> {
  const cars = await getModsCars(instanceId);
  const tracks = await getModsTracks(instanceId);
  if (!cars || !tracks) {
    return null;
  }
  if (cars.cars.length === 0 && tracks.tracks.length === 0 && !cars.meta) {
    return null;
  }
  return {
    carModels: new Set(cars.cars.map((c) => c.carModel.trim()).filter(Boolean)),
    trackSlugs: new Set(tracks.tracks.map((t) => t.trackSlug.trim()).filter(Boolean)),
  };
}
