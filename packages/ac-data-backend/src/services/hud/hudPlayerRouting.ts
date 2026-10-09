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
import {
  parseHudPresenceRecordJson,
  type HudPresenceRecord,
} from '@projectd/ac-data-shared/services/hud/hudPresenceRecord.js';
import { presenceRedisKey } from './hudCacheKeys.js';
import { hudRedisGet, isHudRedisConfigured } from './hudRedis.js';

/** @deprecated Prefer HudPresenceRecord from ac-data-shared — alias kept for hub call sites. */
export type HubPlayerPresenceRecord = HudPresenceRecord;

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
  return parseHudPresenceRecordJson(raw);
}

/** Resolve fleet/dynamic edge from a presence record (no Redis). Exported for tests. */
export function resolveEdgeFromPresence(
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

function allowLegacyServerNameRouting(): boolean {
  const raw = (process.env.HUD_ALLOW_LEGACY_SERVERNAME_ROUTING || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  // Default: allow in non-prod / insecure lab only
  const env = (process.env.ASSETTO_ENV || 'dev').trim().toLowerCase();
  const allowInsecure = (process.env.ALLOW_INSECURE_DEFAULTS || '').trim().toLowerCase() === 'true';
  return (env !== 'prod' && env !== 'production') || allowInsecure;
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
    if (legacy && !allowLegacyServerNameRouting()) {
      console.warn(
        '[hud-routing] legacy serverName routing disabled (set HUD_ALLOW_LEGACY_SERVERNAME_ROUTING=true to override)',
      );
      return { ok: false, reason: 'redis_unavailable' };
    }
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
    if (legacyServerName && allowLegacyServerNameRouting()) {
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
    } else if (legacyServerName) {
      console.warn(
        '[hud-routing] ignoring legacy serverName — require Redis presence (HUD_ALLOW_LEGACY_SERVERNAME_ROUTING)',
      );
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
