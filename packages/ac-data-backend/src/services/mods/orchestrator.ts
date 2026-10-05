import { randomUUID } from 'node:crypto';
import type {
  DesiredArtifactRow,
  EdgeArtifactStatus,
  ModAgentJobPayload,
  SyncJobOperation,
} from '@projectd/ac-data-shared/mods/types.js';
import {
  isEdgeBlobStorageKey,
  parseEdgeBlobStorageKey,
} from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  listFleetEdges,
  resolveFleetEdge,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  assignArtifactToEdges,
  getArtifactById,
  getPackageById,
  listArtifactsForPackage,
  removeArtifactFromEdges,
} from './catalogRepo.js';
import { getModPool } from './db.js';
import { syncFleetEdgesToDb } from './fleetEdgeDb.js';
import { deleteMasterArtifact, getArtifactDownloadUrl, localMasterArtifactExists } from './objectStorage.js';
import { deleteModPreviewImageFile } from './modPreviewImages.js';
import { tryAcquireModLock, releaseModLock, forceReleaseModLock } from './modRedisLocks.js';
import { syncHostCatalogDelete } from '../hostCatalog/index.js';

export { syncFleetEdgesToDb } from './fleetEdgeDb.js';

const MAX_ATTEMPTS = Number(process.env.MOD_SYNC_MAX_ATTEMPTS || 5);
/** Requeue `running` jobs whose started_at is older than this (dead agent / crash). */
const RUNNING_STALE_MS = Number(process.env.MOD_SYNC_RUNNING_STALE_MS || 600_000);

function assertLocalMasterBlobPresent(storageKey: string, sha256: string): void {
  if (isEdgeBlobStorageKey(storageKey)) {
    return;
  }
  if (!localMasterArtifactExists(storageKey)) {
    throw new Error(
      `artifact_blob_missing: master ZIP not on hub disk for sha256=${sha256.slice(0, 12)}… (MOD_UPLOAD_ROOT / wrong MOD_HUB_PUBLIC_URL host)`,
    );
  }
}

async function findPeerEdgeWithBlob(
  artifactId: string,
  sha256: string,
  preferEdgeId?: string | null,
): Promise<string | null> {
  const pool = getModPool();
  if (preferEdgeId) {
    const preferred = await pool.query<{ edge_id: string }>(
      `SELECT edge_id FROM edge_artifact_inventory
       WHERE artifact_id = $1 AND edge_id = $2 AND status = 'READY'
         AND (installed_sha256 IS NULL OR installed_sha256 = $3)
       LIMIT 1`,
      [artifactId, preferEdgeId.toLowerCase(), sha256],
    );
    if (preferred.rows[0]) {
      return preferred.rows[0].edge_id;
    }
  }
  const any = await pool.query<{ edge_id: string }>(
    `SELECT edge_id FROM edge_artifact_inventory
     WHERE artifact_id = $1 AND status = 'READY'
       AND (installed_sha256 IS NULL OR installed_sha256 = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [artifactId, sha256],
  );
  return any.rows[0]?.edge_id ?? null;
}

function peerBlobDownloadUrl(sourceEdgeId: string, sha256: string): string {
  const edge = resolveFleetEdge(sourceEdgeId);
  if (!edge?.baseUrl) {
    throw new Error(`peer_edge_unreachable: no baseUrl for edge ${sourceEdgeId}`);
  }
  const base = edge.baseUrl.replace(/\/+$/, '');
  return `${base}/api/mod-agent/v1/blobs/${encodeURIComponent(sha256)}`;
}

/**
 * Idempotent enqueue: same edge + artifact + active (queued|running) job → reuse.
 * Returns job id (existing or newly created).
 */
export async function enqueueJob(
  edgeId: string,
  artifactId: string,
  operation: SyncJobOperation,
): Promise<string> {
  const pool = getModPool();
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
    [edgeId, artifactId],
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const jobId = randomUUID();
  await pool.query(
    `INSERT INTO sync_jobs (id, edge_id, artifact_id, operation, state) VALUES ($1, $2, $3, $4, 'queued')`,
    [jobId, edgeId, artifactId, operation],
  );
  await pool.query(
    `INSERT INTO sync_job_events (job_id, level, message) VALUES ($1, 'info', $2)`,
    [jobId, `Job queued: ${operation}`],
  );
  await pool.query(
    `UPDATE edge_artifact_inventory SET status = 'PENDING', updated_at = NOW()
     WHERE edge_id = $1 AND artifact_id = $2`,
    [edgeId, artifactId],
  );
  return jobId;
}

/**
 * Assign artifact to one edge and enqueue install if not already active.
 * Idempotent for concurrent ensure(A) calls.
 */
export async function ensureArtifactOnEdge(
  artifactId: string,
  edgeId: string,
): Promise<{ jobId: string; created: boolean }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  if (!isEdgeBlobStorageKey(art.storage_key)) {
    assertLocalMasterBlobPresent(art.storage_key, art.sha256);
  } else {
    const peer = await findPeerEdgeWithBlob(
      artifactId,
      art.sha256,
      parseEdgeBlobStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id,
    );
    if (!peer) {
      throw new Error(
        'artifact_blob_missing: edge-owned mod has no READY source VPS — re-upload to an edge',
      );
    }
  }
  await syncFleetEdgesToDb();
  const normalizedEdge = edgeId.toLowerCase();
  await assignArtifactToEdges(artifactId, art.package_id, [normalizedEdge]);

  const pool = getModPool();
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
    [normalizedEdge, artifactId],
  );
  if (existing.rows[0]) {
    return { jobId: existing.rows[0].id, created: false };
  }
  const jobId = await enqueueJob(normalizedEdge, artifactId, 'install');
  return { jobId, created: true };
}

export async function distributeArtifact(
  artifactId: string,
  edgeIds: string[] | 'all',
): Promise<{ enqueued: number }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  if (!isEdgeBlobStorageKey(art.storage_key)) {
    assertLocalMasterBlobPresent(art.storage_key, art.sha256);
  }
  await syncFleetEdgesToDb();
  const targets =
    edgeIds === 'all'
      ? listFleetEdges().map((e) => e.id)
      : edgeIds.map((id) => id.toLowerCase());
  if (isEdgeBlobStorageKey(art.storage_key)) {
    const source =
      (await findPeerEdgeWithBlob(
        artifactId,
        art.sha256,
        parseEdgeBlobStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id,
      )) ?? null;
    if (!source) {
      throw new Error(
        'artifact_blob_missing: edge-owned mod has no READY source VPS — re-upload to an edge',
      );
    }
    return copyArtifactFromEdge(artifactId, source, targets.filter((id) => id !== source));
  }
  await assignArtifactToEdges(artifactId, art.package_id, targets);
  let enqueued = 0;
  for (const edgeId of targets) {
    const before = await getModPool().query<{ id: string }>(
      `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
      [edgeId, artifactId],
    );
    const hadActive = Boolean(before.rows[0]);
    await enqueueJob(edgeId, artifactId, 'install');
    if (!hadActive) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

/** Peer copy: install jobs on targets; downloadUrl resolved at acquire time from source edge. */
export async function copyArtifactFromEdge(
  artifactId: string,
  sourceEdgeId: string,
  targetEdgeIds: string[],
): Promise<{ enqueued: number }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  const source = sourceEdgeId.trim().toLowerCase();
  const peer = await findPeerEdgeWithBlob(artifactId, art.sha256, source);
  if (!peer) {
    throw new Error(`Source edge ${source} does not have this mod READY`);
  }
  await syncFleetEdgesToDb();
  const targets = targetEdgeIds.map((id) => id.toLowerCase()).filter((id) => id && id !== peer);
  if (!targets.length) {
    return { enqueued: 0 };
  }
  await assignArtifactToEdges(artifactId, art.package_id, targets);
  let enqueued = 0;
  for (const edgeId of targets) {
    const before = await getModPool().query<{ id: string }>(
      `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
      [edgeId, artifactId],
    );
    const hadActive = Boolean(before.rows[0]);
    await enqueueJob(edgeId, artifactId, 'install');
    if (!hadActive) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export async function resyncArtifactOnEdges(artifactId: string, edgeIds: string[]): Promise<number> {
  let enqueued = 0;
  for (const edgeId of edgeIds) {
    const before = await getModPool().query<{ id: string }>(
      `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
      [edgeId, artifactId],
    );
    const hadActive = Boolean(before.rows[0]);
    await enqueueJob(edgeId, artifactId, 'install');
    if (!hadActive) {
      enqueued += 1;
    }
  }
  return enqueued;
}

export async function verifyArtifactOnEdges(artifactId: string, edgeIds: string[]): Promise<number> {
  let enqueued = 0;
  for (const edgeId of edgeIds) {
    const before = await getModPool().query<{ id: string }>(
      `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
      [edgeId, artifactId],
    );
    const hadActive = Boolean(before.rows[0]);
    await enqueueJob(edgeId, artifactId, 'verify');
    if (!hadActive) {
      enqueued += 1;
    }
  }
  return enqueued;
}

export async function removePackageFromEdges(packageId: string, edgeIds: string[]): Promise<void> {
  await removeArtifactFromEdges(packageId, edgeIds);
  const pool = getModPool();
  const arts = await pool.query<{ id: string }>(`SELECT id FROM mod_artifacts WHERE package_id = $1`, [
    packageId,
  ]);
  for (const edgeId of edgeIds) {
    for (const row of arts.rows) {
      await enqueueJob(edgeId, row.id, 'remove');
    }
  }
}

/**
 * Force-delete a catalog package from the hub (DB + master blob + preview).
 * Missing/corrupt blobs do not fail the delete. Edge cache may remain until Remove/GC.
 */
export async function forceDeleteModPackage(packageId: string): Promise<{
  packageId: string;
  displayName: string;
  artifactsRemoved: number;
}> {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error('package_not_found');
  }
  const artifacts = await listArtifactsForPackage(packageId);
  const artifactIds = artifacts.map((a) => a.id);
  const pool = getModPool();

  if (artifactIds.length > 0) {
    await pool.query(
      `UPDATE sync_jobs SET state = 'cancelled', finished_at = NOW()
       WHERE artifact_id = ANY($1::uuid[])
         AND state IN ('queued', 'running')
         AND operation IN ('install', 'upgrade', 'verify')`,
      [artifactIds],
    );
  }

  try {
    await syncFleetEdgesToDb();
    const edgeIds = listFleetEdges().map((e) => e.id);
    if (edgeIds.length > 0) {
      await removePackageFromEdges(packageId, edgeIds);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mods] forceDelete: edge remove enqueue failed: ${message}`);
  }

  for (const art of artifacts) {
    await deleteMasterArtifact(art.storage_key).catch(() => undefined);
  }

  if (pkg.preview_image_filename) {
    await deleteModPreviewImageFile(pkg.preview_image_filename).catch(() => undefined);
  }

  await pool.query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);
  // Split tables use the same UUID as mod_packages (migration 002); clean orphans.
  if (pkg.kind === 'car') {
    await pool.query(`DELETE FROM mod_car_packages WHERE id = $1`, [packageId]).catch(() => undefined);
  } else if (pkg.kind === 'track') {
    await pool.query(`DELETE FROM mod_track_packages WHERE id = $1`, [packageId]).catch(() => undefined);
  }

  await syncHostCatalogDelete({
    kind: pkg.kind,
    acContentSlug: pkg.ac_content_slug,
    displayName: pkg.display_name,
  });

  return {
    packageId,
    displayName: pkg.display_name,
    artifactsRemoved: artifacts.length,
  };
}

/**
 * Requeue sync_jobs stuck in `running` longer than RUNNING_STALE_MS and drop their Redis locks.
 * Call before acquire so a dead agent cannot block the edge queue forever.
 */
export async function reclaimStaleRunningJobs(edgeId: string): Promise<number> {
  const pool = getModPool();
  const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
  const stale = await pool.query<{
    id: string;
    artifact_id: string;
    locked_by: string | null;
  }>(
    `SELECT id, artifact_id, locked_by FROM sync_jobs
     WHERE edge_id = $1 AND state = 'running'
       AND started_at IS NOT NULL AND started_at < $2`,
    [edgeId, staleBefore],
  );
  let reclaimed = 0;
  for (const row of stale.rows) {
    const art = await getArtifactById(row.artifact_id);
    if (art) {
      await forceReleaseModLock(edgeId, art.sha256);
    }
    await pool.query(
      `UPDATE sync_jobs SET state = 'queued', locked_by = NULL, error_code = 'stale_reclaim',
         error_message = 'Requeued after stale running timeout', finished_at = NULL
       WHERE id = $1`,
      [row.id],
    );
    await pool.query(
      `UPDATE edge_artifact_inventory SET status = 'PENDING', updated_at = NOW()
       WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, row.artifact_id],
    );
    await pool.query(
      `INSERT INTO sync_job_events (job_id, level, message) VALUES ($1, 'warn', $2)`,
      [row.id, `Reclaimed stale running job (older than ${RUNNING_STALE_MS}ms)`],
    );
    reclaimed += 1;
  }
  return reclaimed;
}

export async function acquireJobForEdge(edgeId: string, agentId: string): Promise<ModAgentJobPayload | null> {
  await reclaimStaleRunningJobs(edgeId);

  const pool = getModPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobResult = await client.query<{
      id: string;
      artifact_id: string;
      operation: SyncJobOperation;
    }>(
      `SELECT id, artifact_id, operation FROM sync_jobs
       WHERE edge_id = $1 AND state = 'queued'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED`,
      [edgeId],
    );

    for (const job of jobResult.rows) {
      const art = await getArtifactById(job.artifact_id);
      if (!art) {
        await client.query(
          `UPDATE sync_jobs SET state = 'failed', error_message = 'artifact missing', finished_at = NOW() WHERE id = $1`,
          [job.id],
        );
        continue;
      }
      const locked = await tryAcquireModLock(edgeId, art.sha256, agentId);
      if (!locked) {
        // Lock held (another install of same blob or stuck lock) — try next queued job (no HOL).
        continue;
      }

      let downloadUrl: string | undefined;
      if (
        (job.operation === 'install' || job.operation === 'upgrade') &&
        isEdgeBlobStorageKey(art.storage_key)
      ) {
        const prefer =
          parseEdgeBlobStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id ?? null;
        const peer = await findPeerEdgeWithBlob(job.artifact_id, art.sha256, prefer);
        if (peer && peer !== edgeId) {
          downloadUrl = peerBlobDownloadUrl(peer, art.sha256);
        } else if (!peer) {
          await forceReleaseModLock(edgeId, art.sha256);
          await client.query(
            `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
            [job.id, 'No peer edge has this mod READY for download'],
          );
          await client.query(
            `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
             WHERE edge_id = $1 AND artifact_id = $2`,
            [edgeId, job.artifact_id, 'No peer edge has this mod READY'],
          );
          continue;
        }
        // peer === edgeId: local blob cache expected (no downloadUrl).
      }

      await client.query(
        `UPDATE sync_jobs SET state = 'running', locked_by = $2, attempt = attempt + 1, started_at = NOW(), progress_pct = 0, phase = 'download'
         WHERE id = $1`,
        [job.id, agentId],
      );
      await client.query(
        `UPDATE edge_artifact_inventory SET status = 'SYNCING', progress_pct = 0, updated_at = NOW()
         WHERE edge_id = $1 AND artifact_id = $2`,
        [edgeId, job.artifact_id],
      );
      await client.query('COMMIT');
      return {
        jobId: job.id,
        edgeId,
        artifactId: job.artifact_id,
        operation: job.operation,
        sha256: art.sha256,
        storageKey: art.storage_key,
        sizeBytes: Number(art.size_bytes),
        acContentSlug: art.package.ac_content_slug,
        manifest: art.manifest_json,
        versionLabel: art.version_label,
        ...(downloadUrl ? { downloadUrl } : {}),
      };
    }

    await client.query('COMMIT');
    return null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function reportJobProgress(
  jobId: string,
  edgeId: string,
  progressPct: number,
  phase: string,
): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `UPDATE sync_jobs SET progress_pct = $2, phase = $3 WHERE id = $1 AND edge_id = $4`,
    [jobId, progressPct, phase, edgeId],
  );
  const job = await pool.query<{ artifact_id: string }>(`SELECT artifact_id FROM sync_jobs WHERE id = $1`, [
    jobId,
  ]);
  const artifactId = job.rows[0]?.artifact_id;
  if (artifactId) {
    await pool.query(
      `UPDATE edge_artifact_inventory SET status = 'SYNCING', progress_pct = $3, updated_at = NOW()
       WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, artifactId, progressPct],
    );
  }
}

export async function completeJob(
  jobId: string,
  edgeId: string,
  installedSha256: string,
): Promise<void> {
  const pool = getModPool();
  const job = await pool.query<{ artifact_id: string; operation: SyncJobOperation }>(
    `SELECT artifact_id, operation FROM sync_jobs WHERE id = $1 AND edge_id = $2`,
    [jobId, edgeId],
  );
  const row = job.rows[0];
  if (!row) {
    return;
  }
  const art = await getArtifactById(row.artifact_id);
  await pool.query(
    `UPDATE sync_jobs SET state = 'done', progress_pct = 100, finished_at = NOW() WHERE id = $1`,
    [jobId],
  );
  if (row.operation === 'remove') {
    await pool.query(`DELETE FROM edge_artifact_inventory WHERE edge_id = $1 AND artifact_id = $2`, [
      edgeId,
      row.artifact_id,
    ]);
  } else {
    const status: EdgeArtifactStatus =
      installedSha256 === art?.sha256 ? 'READY' : 'OUTDATED';
    await pool.query(
      `INSERT INTO edge_artifact_inventory (edge_id, artifact_id, package_id, status, installed_sha256, progress_pct, updated_at)
       VALUES ($1, $2, $3, $4, $5, 100, NOW())
       ON CONFLICT (edge_id, artifact_id) DO UPDATE SET status = EXCLUDED.status, installed_sha256 = EXCLUDED.installed_sha256,
         progress_pct = 100, error_code = NULL, error_message = NULL, updated_at = NOW()`,
      [edgeId, row.artifact_id, art?.package_id, status, installedSha256],
    );
  }
  const lockHolder = await pool.query<{ locked_by: string | null }>(
    `SELECT locked_by FROM sync_jobs WHERE id = $1`,
    [jobId],
  );
  if (art) {
    await releaseModLock(edgeId, art.sha256, lockHolder.rows[0]?.locked_by ?? edgeId);
  }
  await pool.query(`INSERT INTO sync_job_events (job_id, level, message) VALUES ($1, 'info', 'Job completed')`, [
    jobId,
  ]);
}

export async function failJob(
  jobId: string,
  edgeId: string,
  errorCode: string,
  errorMessage: string,
  retriable: boolean,
): Promise<void> {
  const pool = getModPool();
  const job = await pool.query<{
    artifact_id: string;
    attempt: number;
    locked_by: string | null;
  }>(
    `SELECT artifact_id, attempt, locked_by FROM sync_jobs WHERE id = $1 AND edge_id = $2`,
    [jobId, edgeId],
  );
  const row = job.rows[0];
  if (!row) {
    return;
  }
  const art = await getArtifactById(row.artifact_id);
  const lockHolder = row.locked_by;
  const state = retriable && row.attempt < MAX_ATTEMPTS ? 'queued' : 'failed';
  await pool.query(
    `UPDATE sync_jobs SET state = $2, error_code = $3, error_message = $4, finished_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
     locked_by = NULL WHERE id = $1`,
    [jobId, state, errorCode, errorMessage],
  );
  await pool.query(
    `UPDATE edge_artifact_inventory SET status = 'ERROR', error_code = $3, error_message = $4, updated_at = NOW()
     WHERE edge_id = $1 AND artifact_id = $2`,
    [edgeId, row.artifact_id, errorCode, errorMessage],
  );
  if (art) {
    if (lockHolder) {
      await releaseModLock(edgeId, art.sha256, lockHolder);
    } else {
      await forceReleaseModLock(edgeId, art.sha256);
    }
  }
  await pool.query(
    `INSERT INTO sync_job_events (job_id, level, message, details) VALUES ($1, 'error', $2, $3::jsonb)`,
    [jobId, errorMessage, JSON.stringify({ errorCode, retriable })],
  );
}

export async function getDesiredStateForEdge(edgeId: string): Promise<DesiredArtifactRow[]> {
  const pool = getModPool();
  const result = await pool.query<{
    artifact_id: string;
    package_id: string;
    sha256: string;
    storage_key: string;
    size_bytes: string;
    desired_state: string;
    ac_content_slug: string;
    kind: string;
    manifest_json: DesiredArtifactRow['manifest'];
  }>(
    `SELECT a.id AS artifact_id, a.package_id, a.sha256, a.storage_key, a.size_bytes::text,
            ea.desired_state, p.ac_content_slug, p.kind, a.manifest_json
     FROM edge_artifact_assignments ea
     JOIN mod_artifacts a ON a.id = ea.artifact_id
     JOIN mod_packages p ON p.id = ea.package_id
     WHERE ea.edge_id = $1 AND ea.desired_state = 'present'`,
    [edgeId],
  );
  return result.rows.map((row) => ({
    artifactId: row.artifact_id,
    packageId: row.package_id,
    sha256: row.sha256,
    storageKey: row.storage_key,
    sizeBytes: Number(row.size_bytes),
    operation: 'install',
    acContentSlug: row.ac_content_slug,
    kind: row.kind as DesiredArtifactRow['kind'],
    manifest: row.manifest_json,
  }));
}

export async function getDownloadUrlForArtifact(
  artifactId: string,
): Promise<{ url: string; expiresInSec: number; sha256: string; sizeBytes: number }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  if (isEdgeBlobStorageKey(art.storage_key)) {
    const prefer = parseEdgeBlobStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id ?? null;
    const peer = await findPeerEdgeWithBlob(artifactId, art.sha256, prefer);
    if (!peer) {
      throw new Error(
        'artifact_blob_missing: edge-owned mod has no READY source VPS — re-upload to an edge',
      );
    }
    return {
      url: peerBlobDownloadUrl(peer, art.sha256),
      expiresInSec: 3600,
      sha256: art.sha256,
      sizeBytes: Number(art.size_bytes),
    };
  }
  assertLocalMasterBlobPresent(art.storage_key, art.sha256);
  const signed = await getArtifactDownloadUrl(art.storage_key, art.sha256, Number(art.size_bytes));
  return {
    ...signed,
    sha256: art.sha256,
    sizeBytes: Number(art.size_bytes),
  };
}

export async function applyInventoryReport(
  edgeId: string,
  items: Array<{ artifactId: string; sha256: string; status: EdgeArtifactStatus; bytesOnDisk?: number }>,
): Promise<void> {
  const pool = getModPool();
  for (const item of items) {
    const art = await getArtifactById(item.artifactId);
    if (!art) {
      continue;
    }
    let status = item.status;
    if (status === 'READY' && item.sha256 !== art.sha256) {
      status = 'OUTDATED';
    }
    await pool.query(
      `INSERT INTO edge_artifact_inventory (edge_id, artifact_id, package_id, status, installed_sha256, bytes_on_disk, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (edge_id, artifact_id) DO UPDATE SET status = EXCLUDED.status, installed_sha256 = EXCLUDED.installed_sha256,
         bytes_on_disk = COALESCE(EXCLUDED.bytes_on_disk, edge_artifact_inventory.bytes_on_disk), updated_at = NOW()`,
      [edgeId, item.artifactId, art.package_id, status, item.sha256, item.bytesOnDisk ?? null],
    );
  }
}
