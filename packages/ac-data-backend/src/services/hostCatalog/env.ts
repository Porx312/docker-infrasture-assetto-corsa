/**
 * Env for hub → Convex Host catalog sync (`CONVEX_HOST_CATALOG_*`).
 * Single place for flags and mutation path overrides.
 */
import { isConvexConfigured } from '../convexClient.js';

function envFlagEnabled(name: string, defaultOn: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

/** Resolve mutation path from env or fallback (ProjectD `worker/hostCatalogSync:*`). */
export function mutationPath(envName: string, fallback: string): string {
  const raw = (process.env[envName] || '').trim();
  return raw || fallback;
}

export const HOST_CATALOG_MUTATIONS = {
  upsertCar: () =>
    mutationPath('CONVEX_HOST_CATALOG_UPSERT_CAR', 'worker/hostCatalogSync:workerUpsertBattleCar'),
  deleteCar: () =>
    mutationPath('CONVEX_HOST_CATALOG_DELETE_CAR', 'worker/hostCatalogSync:workerDeleteBattleCar'),
  upsertTrack: () =>
    mutationPath(
      'CONVEX_HOST_CATALOG_UPSERT_TRACK',
      'worker/hostCatalogSync:workerUpsertBattleTrack',
    ),
  deleteTrack: () =>
    mutationPath(
      'CONVEX_HOST_CATALOG_DELETE_TRACK',
      'worker/hostCatalogSync:workerDeleteBattleTrack',
    ),
  upsertServer: () =>
    mutationPath('CONVEX_HOST_CATALOG_UPSERT_SERVER', 'worker/hostCatalogSync:workerUpsertServer'),
  deleteServer: () =>
    mutationPath('CONVEX_HOST_CATALOG_DELETE_SERVER', 'worker/hostCatalogSync:workerDeleteServer'),
} as const;

/**
 * Default on when Convex + worker secret are configured.
 * Set `CONVEX_HOST_CATALOG_SYNC=false` to disable.
 */
export function isHostCatalogSyncEnabled(): boolean {
  if (!envFlagEnabled('CONVEX_HOST_CATALOG_SYNC', true)) {
    return false;
  }
  if (!isConvexConfigured()) {
    return false;
  }
  if (!workerSecret()) {
    return false;
  }
  return true;
}
