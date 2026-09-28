import { hudRedisGet, hudRedisSet, isHudRedisConfigured } from '../hud/hudRedis.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
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
  /** Present only when edge observed them (e.g. .acmod.json) — never invented. */
  version?: string;
  artifactId?: string;
  sha256?: string;
  kind?: string;
};

export type ModTrackInventoryItem = {
  trackSlug: string;
  configs: string[];
  version?: string;
  artifactId?: string;
  sha256?: string;
  kind?: string;
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

/**
 * Redis inventory is keyed by edge AC_INSTANCE_ID (e.g. vps-eu-2).
 * Host often passes fleet edge id (eu) or the reverse — try all aliases.
 */
export function inventoryInstanceIdCandidates(instanceId: string): string[] {
  const id = normalizeInstanceId(instanceId);
  if (!id) {
    return [];
  }
  const out: string[] = [id];
  const edge = resolveFleetEdgeByInstanceId(id);
  if (edge) {
    if (edge.instanceId && !out.includes(edge.instanceId)) {
      out.push(edge.instanceId);
    }
    if (edge.id && !out.includes(edge.id)) {
      out.push(edge.id);
    }
  }
  return out;
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

  const meta: ModsInventoryMeta = {
    etag,
    scannedAt,
    carCount: cars.length,
    trackCount: tracks.length,
  };

  const carsJson = JSON.stringify(cars);
  const tracksJson = JSON.stringify(tracks);
  const metaJson = JSON.stringify(meta);

  // Dual-write under fleet id + AC_INSTANCE_ID aliases so Host lookups never miss skins/layouts.
  for (const keyId of inventoryInstanceIdCandidates(id)) {
    await hudRedisSet(instanceModsCarsKey(keyId), carsJson, MODS_INVENTORY_TTL_SEC);
    await hudRedisSet(instanceModsTracksKey(keyId), tracksJson, MODS_INVENTORY_TTL_SEC);
    await hudRedisSet(instanceModsMetaKey(keyId), metaJson, MODS_INVENTORY_TTL_SEC);
  }
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

async function readMeta(keyId: string): Promise<ModsInventoryMeta | null> {
  const metaRaw = await hudRedisGet(instanceModsMetaKey(keyId));
  if (!metaRaw) {
    return null;
  }
  try {
    return JSON.parse(metaRaw) as ModsInventoryMeta;
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
  const requested = normalizeInstanceId(instanceId);
  let best: { keyId: string; cars: ModCarInventoryItem[]; meta: ModsInventoryMeta | null } | null =
    null;
  for (const keyId of inventoryInstanceIdCandidates(requested)) {
    const cars = (await readJsonArray<ModCarInventoryItem>(instanceModsCarsKey(keyId))) ?? [];
    const meta = await readMeta(keyId);
    if (cars.length > 0 || meta) {
      if (!best || cars.length > best.cars.length) {
        best = { keyId, cars, meta };
      }
    }
  }
  return {
    ok: true,
    instanceId: requested,
    cars: best?.cars ?? [],
    meta: best?.meta ?? null,
  };
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
  const requested = normalizeInstanceId(instanceId);
  let best: {
    keyId: string;
    tracks: ModTrackInventoryItem[];
    meta: ModsInventoryMeta | null;
  } | null = null;
  for (const keyId of inventoryInstanceIdCandidates(requested)) {
    const tracks =
      (await readJsonArray<ModTrackInventoryItem>(instanceModsTracksKey(keyId))) ?? [];
    const meta = await readMeta(keyId);
    if (tracks.length > 0 || meta) {
      if (!best || tracks.length > best.tracks.length) {
        best = { keyId, tracks, meta };
      }
    }
  }
  return {
    ok: true,
    instanceId: requested,
    tracks: best?.tracks ?? [],
    meta: best?.meta ?? null,
  };
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
