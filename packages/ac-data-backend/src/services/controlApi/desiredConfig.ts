import { postToEdgeWorker } from '@projectd/ac-data-shared/services/fleet/edgeWorkerForward.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  isWorkerConvexQueryConfigured,
  queryWorkerConfigSnapshot,
  type WorkerConfigSnapshotResult,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { publishConfigSnapshotToHubRedis } from '../hubConfigSync.js';
import { loadModsSnapshotForValidation } from './modsInventory.js';

export type DesiredConfigBody = {
  instanceId: string;
  serverId?: string;
  configVersion?: string;
  reason?: string;
  /** Optional full snapshot; when omitted, hub pulls from Convex. */
  config?: WorkerConfigSnapshotResult;
};

export type DesiredConfigResult = {
  ok: boolean;
  instanceId: string;
  mode?: 'edge_push' | 'hub_redis';
  edge?: string;
  errors?: string[];
  validatedServers?: number;
};

type ServerConfigRow = {
  serverId?: string;
  serverName?: string;
  track?: string;
  entries?: Array<{ model?: string }>;
  isActive?: boolean;
};

function asServerRows(servers: unknown[]): ServerConfigRow[] {
  return servers.filter((row): row is ServerConfigRow => Boolean(row) && typeof row === 'object');
}

function filterServers(
  servers: ServerConfigRow[],
  serverId?: string,
): ServerConfigRow[] {
  if (!serverId?.trim()) {
    return servers;
  }
  const want = serverId.trim();
  return servers.filter(
    (s) => s.serverId === want || s.serverName === want || String(s.serverId) === want,
  );
}

export function validateConfigAgainstMods(
  servers: ServerConfigRow[],
  inventory: { carModels: Set<string>; trackSlugs: Set<string> },
): string[] {
  const errors: string[] = [];
  for (const server of servers) {
    if (server.isActive === false) {
      continue;
    }
    const track = typeof server.track === 'string' ? server.track.trim() : '';
    if (track && !inventory.trackSlugs.has(track)) {
      errors.push(`track_not_installed:${track}`);
    }
    const entries = Array.isArray(server.entries) ? server.entries : [];
    for (const entry of entries) {
      const model = typeof entry.model === 'string' ? entry.model.trim() : '';
      if (model && !inventory.carModels.has(model)) {
        errors.push(`car_not_installed:${model}`);
      }
    }
  }
  return [...new Set(errors)];
}

export async function applyDesiredConfig(body: DesiredConfigBody): Promise<DesiredConfigResult> {
  const instanceId = body.instanceId.trim();
  if (!instanceId) {
    return { ok: false, instanceId: '', errors: ['instanceId_required'] };
  }

  let snapshot: WorkerConfigSnapshotResult;
  if (body.config && Array.isArray(body.config.servers)) {
    snapshot = {
      ...body.config,
      instanceId: body.config.instanceId || instanceId,
    };
  } else {
    if (!isWorkerConvexQueryConfigured()) {
      return { ok: false, instanceId, errors: ['convex_not_configured'] };
    }
    snapshot = await queryWorkerConfigSnapshot(instanceId);
  }

  const allServers = asServerRows(snapshot.servers);
  const targetServers = filterServers(allServers, body.serverId);
  if (targetServers.length === 0) {
    return { ok: false, instanceId, errors: ['server_not_found'] };
  }

  const inventory = await loadModsSnapshotForValidation(instanceId);
  if (!inventory) {
    return {
      ok: false,
      instanceId,
      errors: ['mods_snapshot_missing'],
      validatedServers: targetServers.length,
    };
  }

  const errors = validateConfigAgainstMods(targetServers, inventory);
  if (errors.length > 0) {
    return {
      ok: false,
      instanceId,
      errors,
      validatedServers: targetServers.length,
    };
  }

  const filteredSnapshot: WorkerConfigSnapshotResult = {
    ...snapshot,
    instanceId,
    servers: body.serverId ? targetServers : snapshot.servers,
    totalServers: body.serverId ? targetServers.length : snapshot.totalServers,
  };

  const reason = body.reason || 'desired-config';
  const edge = resolveFleetEdgeByInstanceId(instanceId);
  if (edge) {
    const forward = await postToEdgeWorker(edge.baseUrl, '/hud/worker/push-config-snapshot', {
      instanceId,
      snapshot: filteredSnapshot,
      reason,
      ...(body.configVersion ? { configVersion: body.configVersion } : {}),
    });
    if (!forward.ok) {
      return {
        ok: false,
        instanceId,
        mode: 'edge_push',
        edge: edge.id,
        errors: [`edge_push_failed:${forward.status}`],
      };
    }
    return {
      ok: true,
      instanceId,
      mode: 'edge_push',
      edge: edge.id,
      validatedServers: targetServers.length,
    };
  }

  await publishConfigSnapshotToHubRedis(filteredSnapshot);
  return {
    ok: true,
    instanceId,
    mode: 'hub_redis',
    validatedServers: targetServers.length,
  };
}
