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
