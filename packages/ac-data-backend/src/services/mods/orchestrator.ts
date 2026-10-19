import { randomUUID } from 'node:crypto';
import type {
  DesiredArtifactRow,
  EdgeArtifactStatus,
  ModAgentJobPayload,
  SyncJobOperation,
} from '@projectd/ac-data-shared/mods/types.js';
import {
  isEdgeFolderStorageKey,
  isEdgeOwnedStorageKey,
  parseEdgeFolderStorageKey,
} from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  isModPeerPullEnabled,
  isModS3PullEnabled,
  isS3CanonicalStorageKey,
  readModS3Fields,
  type ModS3ManifestFields,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';
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
import {
  deleteCanonicalObject,
  getArtifactDownloadUrl,
  storageMode,
} from './objectStorage.js';
import { deleteModPreviewImageFile } from './modPreviewImages.js';
import { tryAcquireModLock, releaseModLock, forceReleaseModLock } from './modRedisLocks.js';
import { syncHostCatalogDelete } from '../hostCatalog/index.js';
import {
  listPackageUsage,
  ModInUseError,
} from './serverModRequirements.js';
import { fleetEdgeSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';

export { syncFleetEdgesToDb } from './fleetEdgeDb.js';
export { ModInUseError } from './serverModRequirements.js';

const MAX_ATTEMPTS = Number(process.env.MOD_SYNC_MAX_ATTEMPTS || 5);
/** Requeue `running` jobs whose started_at is older than this (dead agent / crash). */
const RUNNING_STALE_MS = Number(process.env.MOD_SYNC_RUNNING_STALE_MS || 600_000);
/** Cap concurrent running install/upgrade jobs per edge (env name historical). */
function maxPeerPullConcurrent(): number {
  return Number(process.env.MOD_PEER_PULL_MAX_CONCURRENT || 3);
}

function canPullFromS3(manifest: unknown): ModS3ManifestFields | null {
  if (!isModS3PullEnabled() || storageMode() !== 's3') return null;
  return readModS3Fields(manifest);
}

/** Precise reason when an S3-canonical / library artifact cannot be pulled. */
function s3PullBlockedError(manifest: unknown): string {
  const raw = readModS3Fields(manifest);
  if (storageMode() !== 's3') {
    return 'artifact_blob_missing: MOD_STORAGE_MODE is not s3 (required for Contabo library pull)';
  }
  if (!isModS3PullEnabled()) {
    return raw
      ? 'artifact_blob_missing: S3 key present but MOD_S3_PULL_ENABLED is not 1'
      : 'artifact_blob_missing: MOD_S3_PULL_ENABLED is not 1';
  }
  if (!raw) {
    return 'artifact_blob_missing: no validated s3Key on manifest — re-upload to library or wait for S3 promote';
  }
  return 'artifact_blob_missing: S3 pull unavailable';
}

function remoteSourceError(hasS3Fields: boolean): string {
  if (hasS3Fields && !isModS3PullEnabled()) {
    return 'artifact_blob_missing: S3 key present but MOD_S3_PULL_ENABLED is not 1';
  }
  if (hasS3Fields && storageMode() !== 's3') {
    return 'artifact_blob_missing: S3 key present but MOD_STORAGE_MODE is not s3';
  }
  if (!hasS3Fields && !isModPeerPullEnabled()) {
    return 'artifact_blob_missing: no validated s3Key on manifest and MOD_PEER_PULL_ENABLED is off — wait for S3 promote or re-upload';
  }
  if (!isModPeerPullEnabled()) {
    return 'artifact_blob_missing: no S3 source and peer pull disabled (MOD_PEER_PULL_ENABLED!=1)';
  }
  return 'artifact_blob_missing: no READY peer VPS and no S3 source — adopt/upload or wait for promote';
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

function peerTreeDownloadUrl(sourceEdgeId: string, kind: string, slug: string): string {
  const edge = resolveFleetEdge(sourceEdgeId);
  if (!edge?.baseUrl) {
    throw new Error(`peer_edge_unreachable: no baseUrl for edge ${sourceEdgeId}`);
  }
  const base = edge.baseUrl.replace(/\/+$/, '');
  return `${base}/api/mod-agent/v1/trees/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`;
}

/**
 * Idempotent enqueue: same edge + artifact + active (queued|running) job → reuse.
 * Atomic via partial unique index + ON CONFLICT (AUD2-07).
 * Returns job id (existing or newly created).
 */
export async function enqueueJob(
  edgeId: string,
  artifactId: string,
  operation: SyncJobOperation,
): Promise<string> {
  const pool = getModPool();
  const jobId = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sync_jobs (id, edge_id, artifact_id, operation, state)
     VALUES ($1, $2, $3, $4, 'queued')
     ON CONFLICT (edge_id, artifact_id) WHERE state IN ('queued', 'running') DO NOTHING
     RETURNING id`,
    [jobId, edgeId, artifactId, operation],
  );
  if (inserted.rows[0]) {
    await pool.query(
      `INSERT INTO sync_job_events (job_id, level, message) VALUES ($1, 'info', $2)`,
      [inserted.rows[0].id, `Job queued: ${operation}`],
    );
    await pool.query(
      `UPDATE edge_artifact_inventory SET status = 'PENDING', updated_at = NOW()
       WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, artifactId],
    );
    return inserted.rows[0].id;
  }
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
    [edgeId, artifactId],
  );
  if (!existing.rows[0]) {
    throw new Error('enqueueJob race: active job missing after conflict');
  }
  return existing.rows[0].id;
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
  const s3 = canPullFromS3(art.manifest_json);
  const rawS3 = readModS3Fields(art.manifest_json);
  if (s3 || isS3CanonicalStorageKey(art.storage_key)) {
    if (!s3) {
      throw new Error(s3PullBlockedError(art.manifest_json));
    }
    // Library install path — S3 only.
  } else if (isEdgeFolderStorageKey(art.storage_key)) {
    if (isModPeerPullEnabled()) {
      const prefer = parseEdgeFolderStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id;
      const peer = await findPeerEdgeWithBlob(artifactId, art.sha256, prefer);
      if (!peer) {
        throw new Error(remoteSourceError(Boolean(rawS3)));
      }
    } else {
      throw new Error(remoteSourceError(Boolean(rawS3)));
    }
  } else {
    throw new Error(
      'artifact_blob_missing: hub master ZIP removed — re-upload to S3 library or adopt as edge_folder',
    );
  }
  await syncFleetEdgesToDb();
  const normalizedEdge = edgeId.toLowerCase();
  await assignArtifactToEdges(artifactId, art.package_id, [normalizedEdge]);

  const pool = getModPool();
  const before = await pool.query<{ id: string }>(
    `SELECT id FROM sync_jobs WHERE edge_id = $1 AND artifact_id = $2 AND state IN ('queued', 'running') LIMIT 1`,
    [normalizedEdge, artifactId],
  );
  const jobId = await enqueueJob(normalizedEdge, artifactId, 'install');
  // Best-effort: true when no active job existed before this call (enqueue is the atomic path).
  return { jobId, created: !before.rows[0] };
}

export async function distributeArtifact(
  artifactId: string,
  edgeIds: string[] | 'all',
): Promise<{ enqueued: number }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  const s3 = canPullFromS3(art.manifest_json);
  if (!s3 && !isEdgeOwnedStorageKey(art.storage_key) && !isS3CanonicalStorageKey(art.storage_key)) {
    throw new Error(
      'artifact_blob_missing: hub master ZIP removed — re-upload to S3 library or adopt as edge_folder',
    );
  }
  await syncFleetEdgesToDb();
  const targets =
    edgeIds === 'all'
      ? listFleetEdges().map((e) => e.id)
      : edgeIds.map((id) => id.toLowerCase());
  if (s3 || isS3CanonicalStorageKey(art.storage_key)) {
    if (!s3) {
      throw new Error(s3PullBlockedError(art.manifest_json));
    }
    let enqueued = 0;
    for (const edgeId of targets) {
      const { created } = await ensureArtifactOnEdge(artifactId, edgeId);
      if (created) enqueued += 1;
    }
    return { enqueued };
  }
  if (isEdgeOwnedStorageKey(art.storage_key)) {
    if (!isModPeerPullEnabled()) {
      throw new Error(
        'peer_pull_disabled: artifact has no validated s3Key — wait for S3 promote, re-upload, or set MOD_PEER_PULL_ENABLED=1',
      );
    }
    const prefer =
      parseEdgeFolderStorageKey(art.storage_key)?.edgeId ?? art.source_edge_id;
    const source = (await findPeerEdgeWithBlob(artifactId, art.sha256, prefer)) ?? null;
    if (!source) {
      throw new Error(
        'artifact_blob_missing: edge-owned mod has no READY source VPS — adopt or upload on an edge',
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

/** Peer tree copy: install jobs on targets; treeDownloadUrl resolved at acquire time. */
export async function copyArtifactFromEdge(
  artifactId: string,
  sourceEdgeId: string,
  targetEdgeIds: string[],
): Promise<{ enqueued: number }> {
  if (!isModPeerPullEnabled()) {
    throw new Error(
      'peer_pull_disabled: MOD_PEER_PULL_ENABLED is not 1 (use S3 install / ensure instead)',
    );
  }
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
  if (edgeIds.length === 0) {
    return;
  }
  const usage = await listPackageUsage(packageId, edgeIds);
  if (usage.length > 0) {
    throw new ModInUseError(usage);
  }
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

export type EdgePurgeResult = {
  edgesPurged: string[];
  edgesFailed: Array<{ edgeId: string; message: string }>;
};

/** DELETE local content folder on each edge (404 = already gone). Triggers inventory rescan on edge. */
export async function purgeLocalContentOnEdges(
  kind: 'car' | 'track',
  slug: string,
  edgeIds: string[],
): Promise<EdgePurgeResult> {
  const secret = fleetEdgeSecret();
  const edgesPurged: string[] = [];
  const edgesFailed: Array<{ edgeId: string; message: string }> = [];
  if (!secret) {
    for (const edgeId of edgeIds) {
      edgesFailed.push({ edgeId, message: 'FLEET_EDGE_SECRET missing' });
    }
    return { edgesPurged, edgesFailed };
  }
  const timeoutMs = Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 60_000);
  const settled = await Promise.allSettled(
    edgeIds.map(async (edgeId) => {
      const edge = resolveFleetEdge(edgeId);
      if (!edge?.baseUrl) {
        throw new Error('unknown_edge');
      }
      const url = new URL(
        `/admin/mods/local-content/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`,
        edge.baseUrl.endsWith('/') ? edge.baseUrl : `${edge.baseUrl}/`,
      );
      const upstream = await fetch(url, {
        method: 'DELETE',
        headers: { 'X-Worker-Secret': secret },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (upstream.status === 404) {
        return edgeId;
      }
      if (!upstream.ok) {
        const data = (await upstream.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || `http_${upstream.status}`);
      }
      return edgeId;
    }),
  );
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const edgeId = edgeIds[i]!;
    if (result.status === 'fulfilled') {
      edgesPurged.push(result.value);
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      edgesFailed.push({ edgeId, message });
    }
  }
  return { edgesPurged, edgesFailed };
}

/**
 * Force-delete a catalog package from the hub (DB + S3 + all VPS local folders).
 * Blocked when any server still lists the mod in server_mod_requirements.
 */
export async function forceDeleteModPackage(packageId: string): Promise<{
  packageId: string;
  displayName: string;
  artifactsRemoved: number;
  edgesPurged: string[];
  edgesFailed: Array<{ edgeId: string; message: string }>;
}> {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error('package_not_found');
  }

  const usage = await listPackageUsage(packageId);
  if (usage.length > 0) {
    throw new ModInUseError(usage);
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

  let edgesPurged: string[] = [];
  let edgesFailed: Array<{ edgeId: string; message: string }> = [];
  if (pkg.kind === 'car' || pkg.kind === 'track') {
    try {
      await syncFleetEdgesToDb();
      const edgeIds = listFleetEdges().map((e) => e.id);
      if (edgeIds.length > 0 && pkg.ac_content_slug) {
        const purge = await purgeLocalContentOnEdges(pkg.kind, pkg.ac_content_slug, edgeIds);
        edgesPurged = purge.edgesPurged;
        edgesFailed = purge.edgesFailed;
        if (edgesFailed.length > 0) {
          console.warn(
            `[mods] forceDelete: VPS purge partial package=${packageId} failed=${edgesFailed
              .map((f) => `${f.edgeId}:${f.message}`)
              .join(',')}`,
          );
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mods] forceDelete: VPS purge failed: ${message}`);
    }
  }

  for (const art of artifacts) {
    const s3 = readModS3Fields(art.manifest_json);
    if (s3?.s3Key) {
      await deleteCanonicalObject(s3.s3Key).catch(() => undefined);
    } else if (isS3CanonicalStorageKey(art.storage_key)) {
      await deleteCanonicalObject(art.storage_key).catch(() => undefined);
    }
  }

  if (pkg.preview_image_filename) {
    await deleteModPreviewImageFile(pkg.preview_image_filename).catch(() => undefined);
  }

  await pool.query(`DELETE FROM mod_packages WHERE id = $1`, [packageId]);

  await syncHostCatalogDelete({
    kind: pkg.kind,
    acContentSlug: pkg.ac_content_slug,
    displayName: pkg.display_name,
  });

  return {
    packageId,
    displayName: pkg.display_name,
    artifactsRemoved: artifacts.length,
    edgesPurged,
    edgesFailed,
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
    // Serialize per-edge acquire so MOD_PEER_PULL_MAX_CONCURRENT cannot race (AUD2-07).
    await client.query(`SELECT id FROM fleet_edges WHERE id = $1 FOR UPDATE`, [edgeId]);

    const peerPullCap = maxPeerPullConcurrent();
    if (peerPullCap > 0) {
      const running = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sync_jobs
         WHERE edge_id = $1 AND state = 'running'
           AND operation IN ('install', 'upgrade')`,
        [edgeId],
      );
      const n = Number(running.rows[0]?.count || 0);
      if (n >= peerPullCap) {
        await client.query('COMMIT');
        return null;
      }
    }

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

      let treeDownloadUrl: string | undefined;
      let s3DownloadUrl: string | undefined;
      let s3ObjectSha256: string | undefined;
      let s3ObjectSizeBytes: number | undefined;
      if (job.operation === 'install' || job.operation === 'upgrade') {
        const s3Early = canPullFromS3(art.manifest_json);
        if (
          isS3CanonicalStorageKey(art.storage_key) ||
          (s3Early && !isEdgeFolderStorageKey(art.storage_key))
        ) {
          const s3 = s3Early;
          if (!s3) {
            const errMsg = s3PullBlockedError(art.manifest_json);
            await forceReleaseModLock(edgeId, art.sha256);
            await client.query(
              `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
              [job.id, errMsg],
            );
            await client.query(
              `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
               WHERE edge_id = $1 AND artifact_id = $2`,
              [edgeId, job.artifact_id, errMsg],
            );
            continue;
          }
          try {
            const signed = await getArtifactDownloadUrl(
              s3.s3Key,
              s3.s3Sha256,
              s3.s3SizeBytes,
            );
            s3DownloadUrl = signed.url;
            s3ObjectSha256 = s3.s3Sha256;
            s3ObjectSizeBytes = s3.s3SizeBytes;
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await forceReleaseModLock(edgeId, art.sha256);
            await client.query(
              `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
              [job.id, `S3 download unavailable: ${msg}`],
            );
            await client.query(
              `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
               WHERE edge_id = $1 AND artifact_id = $2`,
              [edgeId, job.artifact_id, 'S3 download unavailable'],
            );
            continue;
          }
        } else if (isEdgeFolderStorageKey(art.storage_key)) {
          const parsed = parseEdgeFolderStorageKey(art.storage_key);
          const prefer = parsed?.edgeId ?? art.source_edge_id ?? null;
          const peer = await findPeerEdgeWithBlob(job.artifact_id, art.sha256, prefer);
          const kind = parsed?.kind ?? art.package.kind;
          const slug = parsed?.slug ?? art.package.ac_content_slug;
          const s3 = canPullFromS3(art.manifest_json);
          const rawS3 = readModS3Fields(art.manifest_json);
          // Local cache on this edge: no remote acquisition.
          if (peer === edgeId) {
            // verify path / no download
          } else if (s3) {
            // Canonical: S3 first (even if a peer READY exists).
            try {
              const signed = await getArtifactDownloadUrl(
                s3.s3Key,
                s3.s3Sha256,
                s3.s3SizeBytes,
              );
              s3DownloadUrl = signed.url;
              s3ObjectSha256 = s3.s3Sha256;
              s3ObjectSizeBytes = s3.s3SizeBytes;
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              if (isModPeerPullEnabled() && peer && peer !== edgeId) {
                treeDownloadUrl = peerTreeDownloadUrl(peer, kind, slug);
                console.warn(
                  `[mod-orchestrator] S3 presign failed (${msg}); falling back to peer tree`,
                );
              } else {
                await forceReleaseModLock(edgeId, art.sha256);
                await client.query(
                  `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
                  [job.id, `S3 download unavailable: ${msg}`],
                );
                await client.query(
                  `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
               WHERE edge_id = $1 AND artifact_id = $2`,
                  [edgeId, job.artifact_id, 'S3 download unavailable'],
                );
                continue;
              }
            }
          } else if (isModPeerPullEnabled() && peer && peer !== edgeId) {
            treeDownloadUrl = peerTreeDownloadUrl(peer, kind, slug);
          } else {
            await forceReleaseModLock(edgeId, art.sha256);
            const errMsg = remoteSourceError(Boolean(rawS3));
            await client.query(
              `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
              [job.id, errMsg],
            );
            await client.query(
              `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
               WHERE edge_id = $1 AND artifact_id = $2`,
              [edgeId, job.artifact_id, errMsg],
            );
            continue;
          }
        } else {
          await forceReleaseModLock(edgeId, art.sha256);
          const errMsg =
            'artifact_blob_missing: unsupported storage (ZIP/hub master removed) — re-upload to S3 library';
          await client.query(
            `UPDATE sync_jobs SET state = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1`,
            [job.id, errMsg],
          );
          await client.query(
            `UPDATE edge_artifact_inventory SET status = 'ERROR', error_message = $3, updated_at = NOW()
             WHERE edge_id = $1 AND artifact_id = $2`,
            [edgeId, job.artifact_id, errMsg],
          );
          continue;
        }
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
        ...(treeDownloadUrl ? { treeDownloadUrl } : {}),
        ...(s3DownloadUrl ? { s3DownloadUrl } : {}),
        ...(s3ObjectSha256 ? { s3ObjectSha256 } : {}),
        ...(s3ObjectSizeBytes !== undefined ? { s3ObjectSizeBytes } : {}),
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
  // Ignore late progress after complete/fail — fire-and-forget edge reports can
  // otherwise overwrite READY/100% back to SYNCING mid-download (e.g. 69%).
  const updated = await pool.query<{ artifact_id: string }>(
    `UPDATE sync_jobs SET progress_pct = $2, phase = $3
     WHERE id = $1 AND edge_id = $4 AND state = 'running'
     RETURNING artifact_id`,
    [jobId, progressPct, phase, edgeId],
  );
  const artifactId = updated.rows[0]?.artifact_id;
  if (!artifactId) {
    return;
  }
  await pool.query(
    `UPDATE edge_artifact_inventory SET status = 'SYNCING', progress_pct = $3, updated_at = NOW()
     WHERE edge_id = $1 AND artifact_id = $2 AND status = 'SYNCING'`,
    [edgeId, artifactId, progressPct],
  );
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
  const s3Any = canPullFromS3(art.manifest_json);
  if (s3Any && (isS3CanonicalStorageKey(art.storage_key) || isEdgeFolderStorageKey(art.storage_key))) {
    const signed = await getArtifactDownloadUrl(s3Any.s3Key, s3Any.s3Sha256, s3Any.s3SizeBytes);
    return {
      url: signed.url,
      expiresInSec: signed.expiresInSec,
      sha256: s3Any.s3Sha256,
      sizeBytes: s3Any.s3SizeBytes,
    };
  }
  if (isEdgeFolderStorageKey(art.storage_key)) {
    const s3 = canPullFromS3(art.manifest_json);
    if (s3) {
      const signed = await getArtifactDownloadUrl(s3.s3Key, s3.s3Sha256, s3.s3SizeBytes);
      return {
        url: signed.url,
        expiresInSec: signed.expiresInSec,
        sha256: s3.s3Sha256,
        sizeBytes: s3.s3SizeBytes,
      };
    }
    if (!isModPeerPullEnabled()) {
      throw new Error(remoteSourceError(Boolean(readModS3Fields(art.manifest_json))));
    }
    const parsed = parseEdgeFolderStorageKey(art.storage_key);
    const prefer = parsed?.edgeId ?? art.source_edge_id ?? null;
    const peer = await findPeerEdgeWithBlob(artifactId, art.sha256, prefer);
    if (!peer) {
      throw new Error(
        'artifact_blob_missing: folder mod has no READY source VPS — adopt or upload on an edge',
      );
    }
    const kind = parsed?.kind ?? art.package.kind;
    const slug = parsed?.slug ?? art.package.ac_content_slug;
    return {
      url: peerTreeDownloadUrl(peer, kind, slug),
      expiresInSec: 3600,
      sha256: art.sha256,
      sizeBytes: Number(art.size_bytes),
    };
  }
  throw new Error(
    'artifact_blob_missing: hub master / ZIP blob download removed — re-upload to S3 library or adopt as edge_folder',
  );
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
