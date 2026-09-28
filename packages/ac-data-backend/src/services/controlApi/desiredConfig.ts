import { postToEdgeWorker } from '@projectd/ac-data-shared/services/fleet/edgeWorkerForward.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  isWorkerConvexQueryConfigured,
  queryWorkerConfigSnapshot,
  type WorkerConfigSnapshotResult,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { publishConfigSnapshotToHubRedis } from '../hubConfigSync.js';
import { loadModsSnapshotForValidation } from './modsInventory.js';
import { isModDbConfigured, getModPool } from '../mods/db.js';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';

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

/** True when edge_artifact_inventory shows READY + matching sha for the latest artifact of this AC slug. */
async function isSlugReadyOnEdge(
  edgeId: string,
  acContentSlug: string,
  kind: ModKind,
): Promise<boolean> {
  if (!isModDbConfigured()) {
    return false;
  }
  const pool = getModPool();
  const art = await pool.query<{ id: string; sha256: string }>(
    `SELECT a.id, a.sha256 FROM mod_artifacts a
     JOIN mod_packages p ON p.id = a.package_id
     WHERE p.ac_content_slug = $1 AND p.kind = $2
     ORDER BY a.created_at DESC LIMIT 1`,
    [acContentSlug, kind],
  );
  const row = art.rows[0];
  if (!row) {
    return false;
  }
  const inv = await pool.query<{ status: string; installed_sha256: string | null }>(
    `SELECT status, installed_sha256 FROM edge_artifact_inventory
     WHERE edge_id = $1 AND artifact_id = $2`,
    [edgeId, row.id],
  );
  const invRow = inv.rows[0];
  return Boolean(
    invRow?.status === 'READY' && invRow.installed_sha256 && invRow.installed_sha256 === row.sha256,
  );
}

async function filterErrorsWithCentralInventory(
  instanceId: string,
  errors: string[],
): Promise<string[]> {
  const edge = resolveFleetEdgeByInstanceId(instanceId);
  if (!edge || !isModDbConfigured() || errors.length === 0) {
    return errors;
  }
  const edgeId = edge.id.toLowerCase();
  const remaining: string[] = [];
  for (const err of errors) {
    const trackMatch = /^track_not_installed:(.+)$/.exec(err);
    if (trackMatch) {
      if (await isSlugReadyOnEdge(edgeId, trackMatch[1], 'track')) {
        continue;
      }
    }
    const carMatch = /^car_not_installed:(.+)$/.exec(err);
    if (carMatch) {
      if (await isSlugReadyOnEdge(edgeId, carMatch[1], 'car')) {
        continue;
      }
    }
    remaining.push(err);
  }
  return remaining;
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
  let errors: string[] = [];
  if (!inventory) {
    // Fall back to central edge inventory (after ensure / before Redis scan catches up)
    errors = validateConfigAgainstMods(targetServers, {
      carModels: new Set(),
      trackSlugs: new Set(),
    });
    errors = await filterErrorsWithCentralInventory(instanceId, errors);
    if (errors.length > 0) {
      return {
        ok: false,
        instanceId,
        errors,
        validatedServers: targetServers.length,
      };
    }
  } else {
    errors = validateConfigAgainstMods(targetServers, inventory);
    errors = await filterErrorsWithCentralInventory(instanceId, errors);
    if (errors.length > 0) {
      return {
        ok: false,
        instanceId,
        errors,
        validatedServers: targetServers.length,
      };
    }
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
