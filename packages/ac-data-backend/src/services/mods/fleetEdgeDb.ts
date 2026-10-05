import {
  listFleetEdges,
  resolveFleetEdge,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { getModPool } from './db.js';
import { upsertFleetEdgeFromRegistry } from './catalogRepo.js';

export function normalizeEdgeId(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Upsert all registry edges into fleet_edges (FK for sync jobs / inventory). */
export async function syncFleetEdgesToDb(): Promise<void> {
  for (const edge of listFleetEdges()) {
    await upsertFleetEdgeFromRegistry(edge.id, edge.label, edge.baseUrl);
  }
}

/** Ensures fleet_edges row exists (FK for server_mod_requirements, sync jobs, etc.). */
export async function ensureFleetEdgeRegistered(rawEdgeId: string): Promise<string> {
  const edgeId = normalizeEdgeId(rawEdgeId);
  if (!edgeId) {
    throw new Error('edgeId is required');
  }

  await syncFleetEdgesToDb();

  const pool = getModPool();
  const existing = await pool.query<{ id: string }>(`SELECT id FROM fleet_edges WHERE id = $1`, [edgeId]);
  if (existing.rows[0]) {
    return edgeId;
  }

  const edge = resolveFleetEdge(edgeId);
  if (edge) {
    await upsertFleetEdgeFromRegistry(edge.id, edge.label, edge.baseUrl);
    return edge.id;
  }

  throw new Error(
    `Unknown fleet edge "${edgeId}". Add it to FLEET_EDGE_REGISTRY (hub .env) and reload the hub.`,
  );
}
