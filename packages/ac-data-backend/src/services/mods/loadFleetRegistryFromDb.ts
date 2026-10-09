import { setRuntimeFleetEdgesFromDb } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { isModDbConfigured } from './db.js';
import { listFleetEdgesDb } from './catalogRepo.js';
import { syncFleetEdgesToDb } from './fleetEdgeDb.js';

/** Env bootstrap → Postgres, then overlay runtime registry from DB (fills gaps). */
export async function loadFleetRegistryFromDb(): Promise<void> {
  if (!isModDbConfigured()) {
    return;
  }
  try {
    await syncFleetEdgesToDb();
    const rows = await listFleetEdgesDb();
    const enabled = rows.filter((r) => r.enabled);
    setRuntimeFleetEdgesFromDb(
      enabled.map((r) => ({
        id: r.id,
        label: r.label,
        baseUrl: r.base_url,
      })),
    );
    console.log(
      `[fleet-registry] runtime overlay from DB edges=${enabled.length} (env FLEET_EDGE_REGISTRY still wins on id conflict)`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[fleet-registry] DB load failed: ${message}`);
  }
}
