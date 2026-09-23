import {
  listFleetEdges,
  resolveFleetEdgeByInstanceId,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  lookupHudEdgeByCompositeKey,
  lookupHudEdgeByInstanceId,
  lookupHudEdgeByServerName,
  lookupHudEdgePublicBaseByInstanceId,
  lookupSingleHudEdgeEntry,
  type HudEdgeRegistryEntry,
} from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import { readServerNameFromRequestQuery } from '@projectd/ac-data-shared/services/hud/hudQueryParams.js';
import { presenceRedisKey } from './hudCacheKeys.js';
import { hudRedisGet, isHudRedisConfigured } from './hudRedis.js';

export type HubPlayerPresenceRecord = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
  updatedAt: number;
  instanceId?: string;
  folderSlug?: string;
};

export type HudPlayerRoutingResult =
  | {
      ok: true;
      steamId: string;
      presence: HubPlayerPresenceRecord;
      edge: HudEdgeRegistryEntry;
      publicBaseUrl: string;
    }
  | {
      ok: false;
      reason: 'player_not_connected' | 'edge_not_registered' | 'redis_unavailable';
      serverName?: string;
      instanceId?: string;
    };

export async function readPlayerPresenceFromRedis(
  steamId: string,
): Promise<HubPlayerPresenceRecord | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const raw = await hudRedisGet(presenceRedisKey(steamId.trim()));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as HubPlayerPresenceRecord;
  } catch {
    return null;
  }
}

function resolveEdgeFromPresence(
  presence: HubPlayerPresenceRecord,
  legacyServerName: string | null,
): HudEdgeRegistryEntry | null {
  const instanceId = presence.instanceId?.trim();
  const folderSlug = presence.folderSlug?.trim();

  if (instanceId && folderSlug) {
    const composite = lookupHudEdgeByCompositeKey(instanceId, folderSlug);
    if (composite) {
      return composite;
    }
  }

  if (instanceId) {
    const fleet = resolveFleetEdgeByInstanceId(instanceId);
    if (fleet) {
      const fromRegistry = lookupHudEdgeByInstanceId(instanceId);
      return {
        baseUrl: fleet.baseUrl,
        publicBaseUrl: fromRegistry?.publicBaseUrl,
        instanceId,
        source: fromRegistry?.source ?? 'dynamic',
      };
    }
    const fromRegistry = lookupHudEdgeByInstanceId(instanceId);
    if (fromRegistry) {
      return fromRegistry;
    }
  }

  const serverKey = presence.serverName?.trim() || legacyServerName;
  if (serverKey) {
    const fromName = lookupHudEdgeByServerName(serverKey);
    if (fromName) {
      return fromName;
    }
  }

  const single = lookupSingleHudEdgeEntry();
  if (single) {
    return single;
  }

  const fleet = listFleetEdges();
  if (fleet.length === 1) {
    const only = fleet[0]!;
    const fromRegistry = only.instanceId
      ? lookupHudEdgeByInstanceId(only.instanceId)
      : null;
    return {
      baseUrl: only.baseUrl,
      publicBaseUrl: fromRegistry?.publicBaseUrl,
      instanceId: only.instanceId ?? presence.instanceId,
      source: fromRegistry?.source ?? 'dynamic',
    };
  }

  return null;
}

function publicBaseForEdge(entry: HudEdgeRegistryEntry, instanceId?: string): string {
  const fromInstance = instanceId ? lookupHudEdgePublicBaseByInstanceId(instanceId) : null;
  if (fromInstance) {
    return fromInstance;
  }
  return entry.publicBaseUrl?.trim() || entry.baseUrl;
}

export async function resolveHudEdgeForSteamId(
  steamId: string,
  options?: { legacyServerName?: string | null },
): Promise<HudPlayerRoutingResult> {
  const trimmed = steamId.trim();
  if (!trimmed) {
    return { ok: false, reason: 'player_not_connected' };
  }

  if (!isHudRedisConfigured()) {
    const legacy = options?.legacyServerName?.trim();
    if (legacy) {
      const edge = lookupHudEdgeByServerName(legacy);
      if (edge) {
        const presence: HubPlayerPresenceRecord = {
          serverName: legacy,
          track: '',
          trackConfig: '',
          carModel: '',
          updatedAt: Date.now(),
        };
        return {
          ok: true,
          steamId: trimmed,
          presence,
          edge,
          publicBaseUrl: publicBaseForEdge(edge, edge.instanceId),
        };
      }
    }
    return { ok: false, reason: 'redis_unavailable' };
  }

  const presence = await readPlayerPresenceFromRedis(trimmed);
  const legacyServerName = options?.legacyServerName?.trim() ?? null;

  if (!presence) {
    if (legacyServerName) {
      const edge = lookupHudEdgeByServerName(legacyServerName);
      if (edge) {
        const stub: HubPlayerPresenceRecord = {
          serverName: legacyServerName,
          track: '',
          trackConfig: '',
          carModel: '',
          updatedAt: Date.now(),
        };
        return {
          ok: true,
          steamId: trimmed,
          presence: stub,
          edge,
          publicBaseUrl: publicBaseForEdge(edge, edge.instanceId),
        };
      }
    }
    return { ok: false, reason: 'player_not_connected' };
  }

  const edge = resolveEdgeFromPresence(presence, legacyServerName);
  if (!edge) {
    return {
      ok: false,
      reason: 'edge_not_registered',
      serverName: presence.serverName,
      instanceId: presence.instanceId,
    };
  }

  return {
    ok: true,
    steamId: trimmed,
    presence,
    edge,
    publicBaseUrl: publicBaseForEdge(edge, presence.instanceId ?? edge.instanceId),
  };
}

export function legacyServerNameFromQuery(query: Record<string, unknown>): string | null {
  return readServerNameFromRequestQuery(query as import('express').Request['query']);
}
