import { randomUUID } from 'node:crypto';
import type {
  DesiredArtifactRow,
  EdgeArtifactStatus,
  ModAgentJobPayload,
  SyncJobOperation,
} from '@projectd/ac-data-shared/mods/types.js';
import { listFleetEdges } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  assignArtifactToEdges,
  getArtifactById,
  removeArtifactFromEdges,
  upsertFleetEdgeFromRegistry,
} from './catalogRepo.js';
import { getModPool } from './db.js';
import { getArtifactDownloadUrl } from './objectStorage.js';
import { tryAcquireModLock, releaseModLock } from './modRedisLocks.js';

const MAX_ATTEMPTS = Number(process.env.MOD_SYNC_MAX_ATTEMPTS || 5);

export async function syncFleetEdgesToDb(): Promise<void> {
  for (const edge of listFleetEdges()) {
    await upsertFleetEdgeFromRegistry(edge.id, edge.label, edge.baseUrl);
  }
}

async function enqueueJob(
  edgeId: string,
  artifactId: string,
  operation: SyncJobOperation,
): Promise<string | null> {
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

export async function distributeArtifact(
  artifactId: string,
  edgeIds: string[] | 'all',
): Promise<{ enqueued: number }> {
  const art = await getArtifactById(artifactId);
  if (!art) {
    throw new Error('Artifact not found');
  }
  await syncFleetEdgesToDb();
  const targets =
    edgeIds === 'all'
      ? listFleetEdges().map((e) => e.id)
      : edgeIds.map((id) => id.toLowerCase());
  await assignArtifactToEdges(artifactId, art.package_id, targets);
  let enqueued = 0;
  for (const edgeId of targets) {
    const op: SyncJobOperation = 'install';
    const jobId = await enqueueJob(edgeId, artifactId, op);
    if (jobId) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export async function resyncArtifactOnEdges(artifactId: string, edgeIds: string[]): Promise<number> {
  let enqueued = 0;
  for (const edgeId of edgeIds) {
    const jobId = await enqueueJob(edgeId, artifactId, 'install');
    if (jobId) {
      enqueued += 1;
    }
  }
  return enqueued;
}

export async function verifyArtifactOnEdges(artifactId: string, edgeIds: string[]): Promise<number> {
  let enqueued = 0;
  for (const edgeId of edgeIds) {
    const jobId = await enqueueJob(edgeId, artifactId, 'verify');
    if (jobId) {
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

export async function acquireJobForEdge(edgeId: string, agentId: string): Promise<ModAgentJobPayload | null> {
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
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [edgeId],
    );
    const job = jobResult.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    const art = await getArtifactById(job.artifact_id);
    if (!art) {
      await client.query(
        `UPDATE sync_jobs SET state = 'failed', error_message = 'artifact missing', finished_at = NOW() WHERE id = $1`,
        [job.id],
      );
      await client.query('COMMIT');
      return null;
    }
    const locked = await tryAcquireModLock(edgeId, art.sha256, agentId);
    if (!locked) {
      await client.query('COMMIT');
      return null;
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
    };
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
  const job = await pool.query<{ artifact_id: string; attempt: number }>(
    `SELECT artifact_id, attempt FROM sync_jobs WHERE id = $1 AND edge_id = $2`,
    [jobId, edgeId],
  );
  const row = job.rows[0];
  if (!row) {
    return;
  }
  const art = await getArtifactById(row.artifact_id);
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
  const lockHolder = await pool.query<{ locked_by: string | null }>(
    `SELECT locked_by FROM sync_jobs WHERE id = $1`,
    [jobId],
  );
  if (art) {
    await releaseModLock(edgeId, art.sha256, lockHolder.rows[0]?.locked_by ?? edgeId);
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
