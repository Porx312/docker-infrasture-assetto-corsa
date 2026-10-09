import {
  buildDynamicEntriesForSync,
  mergeDynamicRegistryMaps,
} from '@projectd/ac-data-shared/services/hud/hudRegistrySyncApply.js';
import type { HudRegistrySyncPayload } from '@projectd/ac-data-shared/services/hud/hudDynamicRegistryTypes.js';
import {
  getDynamicHudEdgeRegistryForTests,
  setDynamicHudEdgeRegistry,
  type HudEdgeRegistryEntry,
} from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import { getHudRedisClient, isHudRedisConfigured } from '@projectd/ac-data-shared/services/hud/hudRedis.js';

const REDIS_KEY = process.env.HUD_DYNAMIC_REGISTRY_REDIS_KEY || 'ac:hud:registry:state';

type PersistedEntry = HudEdgeRegistryEntry & { updatedAt: number };
type PersistedState = {
  entries: Record<string, PersistedEntry>;
};

export function hudRegistryStaleMs(): number {
  return Number(process.env.HUD_REGISTRY_STALE_MS || 600_000);
}

/** Drop stale persisted entries (hub restart / Redis reload). Exported for tests. */
export function entriesMapFromRecord(
  record: Record<string, PersistedEntry>,
  nowMs: number = Date.now(),
  staleWindowMs: number = hudRegistryStaleMs(),
): Map<string, HudEdgeRegistryEntry> {
  const map = new Map<string, HudEdgeRegistryEntry>();
  const cutoff = nowMs - staleWindowMs;
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry?.updatedAt !== 'number' || entry.updatedAt < cutoff) {
      continue;
    }
    if (typeof entry.baseUrl !== 'string' || !entry.baseUrl.trim()) {
      continue;
    }
    map.set(key, {
      baseUrl: entry.baseUrl,
      publicBaseUrl: entry.publicBaseUrl,
      instanceId: entry.instanceId,
      source: 'dynamic',
    });
  }
  return map;
}

function mapToPersistedRecord(map: Map<string, HudEdgeRegistryEntry>, updatedAt: number): Record<string, PersistedEntry> {
  const out: Record<string, PersistedEntry> = {};
  for (const [key, entry] of map) {
    out[key] = { ...entry, updatedAt };
  }
  return out;
}

export async function loadHudDynamicRegistryFromRedis(): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  try {
    const client = await getHudRedisClient();
    const raw = await client.get(REDIS_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.entries || typeof parsed.entries !== 'object') {
      return;
    }
    setDynamicHudEdgeRegistry(entriesMapFromRecord(parsed.entries));
    console.log(
      `[hud-dynamic-registry] loaded ${getDynamicHudEdgeRegistryForTests().size} lobby mapping(s) from Redis`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-dynamic-registry] Redis load failed: ${message}`);
  }
}

async function persistDynamicRegistry(
  map: Map<string, HudEdgeRegistryEntry>,
  updatedAt: number,
): Promise<void> {
  if (!isHudRedisConfigured()) {
    return;
  }
  const client = await getHudRedisClient();
  const payload: PersistedState = { entries: mapToPersistedRecord(map, updatedAt) };
  await client.set(REDIS_KEY, JSON.stringify(payload));
}

export type HudRegistrySyncResult = {
  ok: true;
  instanceId: string;
  serverCount: number;
  collisionWarnings: string[];
};

export async function applyHudRegistrySync(
  payload: HudRegistrySyncPayload,
): Promise<HudRegistrySyncResult> {
  const instanceId = payload.instanceId.trim();
  const baseUrl = payload.baseUrl.trim();
  if (!instanceId || !baseUrl) {
    throw new Error('instanceId and baseUrl required');
  }

  // After hub restart, in-memory map may be empty if Redis load raced — refill once.
  if (getDynamicHudEdgeRegistryForTests().size === 0) {
    await loadHudDynamicRegistryFromRedis();
  }

  const updatedAt = Date.now();
  const newForInstance = buildDynamicEntriesForSync(payload, updatedAt);
  const current = getDynamicHudEdgeRegistryForTests();
  const collisionWarnings: string[] = [];

  for (const [serverKey] of newForInstance) {
    const existing = current.get(serverKey);
    if (existing?.instanceId && existing.instanceId !== instanceId) {
      collisionWarnings.push(
        `lobby "${serverKey}" was instance ${existing.instanceId}, now ${instanceId}`,
      );
    }
  }

  const merged = mergeDynamicRegistryMaps(current, instanceId, newForInstance);
  setDynamicHudEdgeRegistry(merged);
  await persistDynamicRegistry(merged, updatedAt);

  if (collisionWarnings.length > 0) {
    console.warn(`[hud-dynamic-registry] sync instance=${instanceId}: ${collisionWarnings.join('; ')}`);
  } else {
    console.log(
      `[hud-dynamic-registry] sync instance=${instanceId} servers=${newForInstance.size} total=${merged.size}`,
    );
  }

  return {
    ok: true,
    instanceId,
    serverCount: newForInstance.size,
    collisionWarnings,
  };
}
