import {
  buildAcstuffJoinUrl,
} from '@projectd/ac-data-shared/services/acstuffJoinUrl.js';
import {
  resolveFleetEdgeByInstanceId,
  resolveFleetJoinIp,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { normalizeHudServerName } from '@projectd/ac-data-shared/services/hud/hudQueryNormalize.js';

import {
  fetchMergedFleetServers,
  type FleetServerRow,
} from '../fleet/fleetServersMerge.js';

export type ServerJoinEndpoint = {
  ip: string | null;
  httpPort: number | null;
  joinUrl: string | null;
};

const EMPTY_JOIN: ServerJoinEndpoint = {
  ip: null,
  httpPort: null,
  joinUrl: null,
};

const CACHE_TTL_MS = 30_000;

type FleetCache = {
  at: number;
  servers: FleetServerRow[];
};

let fleetCache: FleetCache | null = null;

export function resetJoinEndpointCacheForTests(): void {
  fleetCache = null;
}

async function loadFleetServersCached(): Promise<FleetServerRow[]> {
  const now = Date.now();
  if (fleetCache && now - fleetCache.at < CACHE_TTL_MS) {
    return fleetCache.servers;
  }
  const result = await fetchMergedFleetServers();
  fleetCache = { at: now, servers: result.servers };
  return result.servers;
}

/** Exported for unit tests — match branding row without network. */
export function matchFleetServerRow(
  servers: FleetServerRow[],
  opts: {
    instanceId?: string | null;
    lobbyName?: string | null;
    folderSlug?: string | null;
  },
): FleetServerRow | null {
  const instanceId = (opts.instanceId || '').trim();
  const folderSlug = (opts.folderSlug || '').trim();
  const lobby = normalizeHudServerName(opts.lobbyName || '');

  const scoped = instanceId
    ? servers.filter((row) => (row.instanceId || '').trim() === instanceId)
    : servers;
  const pool = scoped.length ? scoped : servers;

  if (folderSlug) {
    const byFolder = pool.find((row) => row.name === folderSlug);
    if (byFolder) {
      return byFolder;
    }
  }

  if (lobby) {
    const byLobby = pool.find(
      (row) => normalizeHudServerName(row.displayName || row.name) === lobby,
    );
    if (byLobby) {
      return byLobby;
    }
  }

  return null;
}

function endpointFromRow(
  row: FleetServerRow | null,
  instanceIdHint?: string | null,
): ServerJoinEndpoint {
  const instanceId =
    (row?.instanceId || instanceIdHint || '').trim() || null;
  const edge = instanceId ? resolveFleetEdgeByInstanceId(instanceId) : null;
  const ip = edge ? resolveFleetJoinIp(edge) : null;
  const httpPort =
    row?.httpPort != null && Number.isFinite(row.httpPort) ? row.httpPort : null;
  return {
    ip,
    httpPort,
    joinUrl: buildAcstuffJoinUrl(ip, httpPort),
  };
}

export async function resolveServerJoinEndpoint(opts: {
  instanceId?: string | null;
  lobbyName?: string | null;
  folderSlug?: string | null;
}): Promise<ServerJoinEndpoint> {
  try {
    const servers = await loadFleetServersCached();
    const row = matchFleetServerRow(servers, opts);
    if (!row && !(opts.instanceId || '').trim()) {
      return EMPTY_JOIN;
    }
    return endpointFromRow(row, opts.instanceId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[join-endpoint] resolve failed: ${message}`);
    return EMPTY_JOIN;
  }
}
