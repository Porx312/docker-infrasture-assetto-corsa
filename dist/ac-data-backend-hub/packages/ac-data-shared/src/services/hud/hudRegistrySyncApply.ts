import { normalizeHudServerName } from './hudQueryNormalize.js';
import type { HudDynamicRegistryEntry, HudRegistrySyncPayload } from './hudDynamicRegistryTypes.js';
import type { HudEdgeRegistryEntry } from './hudEdgeRegistry.js';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function serverNamesFromRegistrySync(payload: HudRegistrySyncPayload): string[] {
  const names = new Set<string>();
  for (const row of payload.servers) {
    const display = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    const folder = typeof row.serverName === 'string' ? row.serverName.trim() : '';
    if (display) {
      names.add(normalizeHudServerName(display));
    }
    if (folder) {
      names.add(normalizeHudServerName(folder));
    }
  }
  return [...names].filter(Boolean);
}

/** Build per-lobby entries for one instance sync (caller merges into global map). */
export function buildDynamicEntriesForSync(
  payload: HudRegistrySyncPayload,
  updatedAt: number,
): Map<string, HudDynamicRegistryEntry> {
  const baseUrl = trimTrailingSlash(payload.baseUrl.trim());
  const publicBaseUrl = trimTrailingSlash(
    (payload.publicBaseUrl?.trim() || payload.baseUrl.trim()),
  );
  const instanceId = payload.instanceId.trim();
  const out = new Map<string, HudDynamicRegistryEntry>();

  for (const name of serverNamesFromRegistrySync(payload)) {
    out.set(name, {
      baseUrl,
      publicBaseUrl,
      instanceId,
      updatedAt,
    });
  }
  return out;
}

export function mergeDynamicRegistryMaps(
  current: Map<string, HudEdgeRegistryEntry>,
  instanceId: string,
  newForInstance: Map<string, HudDynamicRegistryEntry>,
): Map<string, HudEdgeRegistryEntry> {
  const merged = new Map(current);
  for (const [key, entry] of merged) {
    if (entry.instanceId === instanceId) {
      merged.delete(key);
    }
  }
  for (const [key, row] of newForInstance) {
    merged.set(key, {
      baseUrl: row.baseUrl,
      publicBaseUrl: row.publicBaseUrl,
      instanceId: row.instanceId,
      source: 'dynamic',
    });
  }
  return merged;
}
