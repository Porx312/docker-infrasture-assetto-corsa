import { normalizeHudServerName } from './hudQueryNormalize.js';

export type HudEdgeRegistryEntry = {
  baseUrl: string;
  publicBaseUrl?: string;
  instanceId?: string;
  source?: 'env' | 'dynamic';
};

let cached: Map<string, HudEdgeRegistryEntry> | null = null;
let dynamicByServer: Map<string, HudEdgeRegistryEntry> = new Map();

function parseRegistryJson(raw: string): Map<string, HudEdgeRegistryEntry> {
  const map = new Map<string, HudEdgeRegistryEntry>();
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return map;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalizedKey = normalizeHudServerName(key);
    if (!normalizedKey) {
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      map.set(normalizedKey, { baseUrl: trimTrailingSlash(value.trim()) });
      continue;
    }
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      const baseUrl = typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '';
      if (!baseUrl) {
        continue;
      }
      const instanceId =
        typeof row.instanceId === 'string' ? row.instanceId.trim() : undefined;
      map.set(normalizedKey, { baseUrl: trimTrailingSlash(baseUrl), instanceId });
    }
  }
  return map;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function loadRegistry(): Map<string, HudEdgeRegistryEntry> {
  if (cached) {
    return cached;
  }
  const raw = (process.env.HUD_EDGE_REGISTRY || '').trim();
  if (!raw) {
    cached = new Map();
    return cached;
  }
  console.warn(
    '[hud-edge-registry] HUD_EDGE_REGISTRY is deprecated — prefer dynamic sync + FLEET_EDGE_REGISTRY bootstrap',
  );
  try {
    cached = parseRegistryJson(raw);
  } catch (err) {
    console.error('[hud-edge-registry] failed to parse HUD_EDGE_REGISTRY:', err);
    cached = new Map();
  }
  return cached;
}

export function resetHudEdgeRegistryForTests(): void {
  cached = null;
  dynamicByServer = new Map();
}

/** Hub: replace dynamic lobby→edge map (from Redis sync or POST /hud/registry/sync). */
export function setDynamicHudEdgeRegistry(entries: Map<string, HudEdgeRegistryEntry>): void {
  dynamicByServer = entries;
}

export function getDynamicHudEdgeRegistryForTests(): Map<string, HudEdgeRegistryEntry> {
  return dynamicByServer;
}

export function lookupHudEdgeByServerName(serverName: string): HudEdgeRegistryEntry | null {
  const normalized = normalizeHudServerName(serverName);
  if (!normalized) {
    return null;
  }
  const fromEnv = loadRegistry().get(normalized);
  if (fromEnv) {
    return { ...fromEnv, source: 'env' };
  }
  const fromDynamic = dynamicByServer.get(normalized);
  if (fromDynamic) {
    return { ...fromDynamic, source: 'dynamic' };
  }
  return null;
}

export function resolveHudEdgePublicBaseUrl(serverName: string): string | null {
  const entry = lookupHudEdgeByServerName(serverName);
  if (!entry) {
    return null;
  }
  return entry.publicBaseUrl?.trim() || entry.baseUrl;
}

export function resolveHudEdgeBaseUrl(serverName: string): string | null {
  return lookupHudEdgeByServerName(serverName)?.baseUrl ?? null;
}

function findRegistryEntryByInstanceId(instanceId: string): HudEdgeRegistryEntry | null {
  const trimmed = instanceId.trim();
  if (!trimmed) {
    return null;
  }
  for (const entry of loadRegistry().values()) {
    if (entry.instanceId === trimmed) {
      return { ...entry, source: 'env' };
    }
  }
  for (const entry of dynamicByServer.values()) {
    if (entry.instanceId === trimmed) {
      return { ...entry, source: 'dynamic' };
    }
  }
  return null;
}

export function lookupHudEdgeByInstanceId(instanceId: string): HudEdgeRegistryEntry | null {
  return findRegistryEntryByInstanceId(instanceId);
}

export function lookupHudEdgePublicBaseByInstanceId(instanceId: string): string | null {
  const entry = findRegistryEntryByInstanceId(instanceId);
  if (!entry) {
    return null;
  }
  return entry.publicBaseUrl?.trim() || entry.baseUrl;
}

/** Stable per-VPS lobby key from edge registry sync (`instanceId:folderSlug`). */
export function hudRegistryCompositeKey(instanceId: string, folderSlug: string): string {
  return `${instanceId.trim()}:${folderSlug.trim().toLowerCase()}`;
}

export function lookupHudEdgeByCompositeKey(instanceId: string, folderSlug: string): HudEdgeRegistryEntry | null {
  const key = hudRegistryCompositeKey(instanceId, folderSlug);
  const fromEnv = loadRegistry().get(key);
  if (fromEnv) {
    return { ...fromEnv, source: 'env' };
  }
  const fromDynamic = dynamicByServer.get(key);
  if (fromDynamic) {
    return { ...fromDynamic, source: 'dynamic' };
  }
  return null;
}

/** When fleet env is empty, use the sole dynamic/env edge if unambiguous. */
export function lookupSingleHudEdgeEntry(): HudEdgeRegistryEntry | null {
  const seen = new Map<string, HudEdgeRegistryEntry>();
  for (const entry of loadRegistry().values()) {
    seen.set(entry.baseUrl, { ...entry, source: 'env' });
  }
  for (const entry of dynamicByServer.values()) {
    seen.set(entry.baseUrl, { ...entry, source: 'dynamic' });
  }
  if (seen.size === 1) {
    return [...seen.values()][0] ?? null;
  }
  return null;
}
