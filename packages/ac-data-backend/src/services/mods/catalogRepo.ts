import { randomUUID } from 'node:crypto';
import type { EdgeArtifactStatus, ModKind, ModManifest, SyncJobOperation } from '@projectd/ac-data-shared/mods/types.js';
import { getModPool } from './db.js';

export type ModPackageRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: ModKind;
  ac_content_slug: string;
  notes: string | null;
  /** Free-form catalog label (drift, pack, …). Null = uncategorized. */
  category: string | null;
  preview_image_filename: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ModArtifactRow = {
  id: string;
  package_id: string;
  version_label: string;
  size_bytes: string;
  sha256: string;
  storage_key: string;
  manifest_json: ModManifest;
  created_at: Date;
  storage_origin?: 'hub' | 'edge';
  source_edge_id?: string | null;
};

export type EdgeProcessSample = {
  name: string;
  kind: 'acServer' | 'cm-proxy' | 'orphan';
  pid: number;
  rssBytes: number;
  cpuPct: number | null;
  cmdline?: string;
};

export type FleetEdgeRow = {
  id: string;
  label: string;
  base_url: string;
  enabled: boolean;
  last_seen_at: Date | null;
  disk_free_bytes: string | null;
  cpu_count: number | null;
  load1: number | null;
  mem_total_bytes: string | null;
  mem_free_bytes: string | null;
  disk_total_bytes: string | null;
  servers_total: number | null;
  servers_running: number | null;
  processes_json: EdgeProcessSample[] | null;
};

export type EdgeHeartbeatMetrics = {
  diskFreeBytes?: number;
  diskTotalBytes?: number;
  cpuCount?: number;
  load1?: number;
  memTotalBytes?: number;
  memFreeBytes?: number;
  serversTotal?: number;
  serversRunning?: number;
  processes?: EdgeProcessSample[];
};

export type EdgeCapacityEstimate = {
  serversExtraEstimate: number;
  estByRam: number;
  estByCpu: number;
  ramMbPerServer: number;
  loadPerServer: number;
  headroomRamBytes: number;
  headroomCpu: number;
};

function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Estimate how many more AC servers fit on this edge (RAM + CPU headroom). */
export function estimateEdgeCapacity(edge: {
  cpu_count?: number | null;
  load1?: number | null;
  mem_total_bytes?: string | number | null;
  mem_free_bytes?: string | number | null;
}): EdgeCapacityEstimate | null {
  const cpuCount = edge.cpu_count != null ? Number(edge.cpu_count) : NaN;
  const load1 = edge.load1 != null ? Number(edge.load1) : NaN;
  const memTotal = edge.mem_total_bytes != null ? Number(edge.mem_total_bytes) : NaN;
  const memFree = edge.mem_free_bytes != null ? Number(edge.mem_free_bytes) : NaN;
  if (
    !Number.isFinite(cpuCount) ||
    cpuCount <= 0 ||
    !Number.isFinite(load1) ||
    !Number.isFinite(memTotal) ||
    memTotal <= 0 ||
    !Number.isFinite(memFree)
  ) {
    return null;
  }

  const ramMbPerServer = envPositiveNumber('EDGE_CAPACITY_RAM_MB_PER_SERVER', 2048);
  const loadPerServer = envPositiveNumber('EDGE_CAPACITY_LOAD_PER_SERVER', 1);
  const ramPerServerBytes = ramMbPerServer * 1024 * 1024;

  const headroomRamBytes = Math.max(0, memFree - 0.15 * memTotal);
  const headroomCpu = Math.max(0, cpuCount - load1 - 1);
  const estByRam = Math.floor(headroomRamBytes / ramPerServerBytes);
  const estByCpu = Math.floor(headroomCpu / loadPerServer);
  const serversExtraEstimate = Math.max(0, Math.min(estByRam, estByCpu));

  return {
    serversExtraEstimate,
    estByRam,
    estByCpu,
    ramMbPerServer,
    loadPerServer,
    headroomRamBytes,
    headroomCpu,
  };
}

export async function upsertFleetEdgeFromRegistry(
  id: string,
  label: string,
  baseUrl: string,
): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `INSERT INTO fleet_edges (id, label, base_url, enabled, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, base_url = EXCLUDED.base_url, updated_at = NOW()`,
    [id, label, baseUrl],
  );
}

export async function listFleetEdgesDb(): Promise<FleetEdgeRow[]> {
  const pool = getModPool();
  const result = await pool.query<FleetEdgeRow>(
    `SELECT id, label, base_url, enabled, last_seen_at,
            disk_free_bytes::text, disk_total_bytes::text,
            cpu_count, load1,
            mem_total_bytes::text, mem_free_bytes::text,
            servers_total, servers_running,
            processes_json
     FROM fleet_edges ORDER BY label`,
  );
  return result.rows;
}

export async function setFleetEdgeEnabled(id: string, enabled: boolean): Promise<void> {
  const pool = getModPool();
  await pool.query(`UPDATE fleet_edges SET enabled = $2, updated_at = NOW() WHERE id = $1`, [id, enabled]);
}

export async function recordEdgeHeartbeat(
  edgeId: string,
  metrics: EdgeHeartbeatMetrics = {},
): Promise<void> {
  const pool = getModPool();
  const processesJson =
    metrics.processes !== undefined ? JSON.stringify(metrics.processes) : null;
  await pool.query(
    `UPDATE fleet_edges SET
       last_seen_at = NOW(),
       disk_free_bytes = COALESCE($2, disk_free_bytes),
       disk_total_bytes = COALESCE($3, disk_total_bytes),
       cpu_count = COALESCE($4, cpu_count),
       load1 = COALESCE($5, load1),
       mem_total_bytes = COALESCE($6, mem_total_bytes),
       mem_free_bytes = COALESCE($7, mem_free_bytes),
       servers_total = COALESCE($8, servers_total),
       servers_running = COALESCE($9, servers_running),
       processes_json = COALESCE($10::jsonb, processes_json),
       updated_at = NOW()
     WHERE id = $1`,
    [
      edgeId,
      metrics.diskFreeBytes ?? null,
      metrics.diskTotalBytes ?? null,
      metrics.cpuCount ?? null,
      metrics.load1 ?? null,
      metrics.memTotalBytes ?? null,
      metrics.memFreeBytes ?? null,
      metrics.serversTotal ?? null,
      metrics.serversRunning ?? null,
      processesJson,
    ],
  );
}

export async function createUploadSession(
  uploadId: string,
  originalName: string,
  stagingPath: string,
): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `INSERT INTO mod_upload_sessions (upload_id, original_name, staging_path, state) VALUES ($1, $2, $3, 'uploading')`,
    [uploadId, originalName, stagingPath],
  );
}

export async function getUploadSession(uploadId: string) {
  const pool = getModPool();
  const result = await pool.query(`SELECT * FROM mod_upload_sessions WHERE upload_id = $1`, [uploadId]);
  return result.rows[0] as Record<string, unknown> | undefined;
}

export async function updateUploadSession(
  uploadId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const pool = getModPool();
  const fields: string[] = [];
  const values: unknown[] = [uploadId];
  let idx = 2;
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = $${idx}`);
    values.push(value);
    idx += 1;
  }
  fields.push('updated_at = NOW()');
  await pool.query(`UPDATE mod_upload_sessions SET ${fields.join(', ')} WHERE upload_id = $1`, values);
}

export async function createPackageAndArtifact(input: {
  slug: string;
  displayName: string;
  kind: ModKind;
  acContentSlug: string;
  versionLabel: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  manifest: ModManifest;
  storageOrigin?: 'hub' | 'edge';
  sourceEdgeId?: string | null;
}): Promise<{ packageId: string; artifactId: string }> {
  const pool = getModPool();
  const artifactId = randomUUID();
  const storageOrigin = input.storageOrigin ?? 'hub';
  const sourceEdgeId = input.sourceEdgeId?.trim() || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM mod_packages WHERE slug = $1`,
      [input.slug],
    );
    let resolvedPackageId: string;
    if (existing.rows[0]) {
      resolvedPackageId = existing.rows[0].id;
      await client.query(
        `UPDATE mod_packages SET display_name = $2, kind = $3, ac_content_slug = $4, updated_at = NOW() WHERE id = $1`,
        [resolvedPackageId, input.displayName, input.kind, input.acContentSlug],
      );
    } else {
      resolvedPackageId = randomUUID();
      await client.query(
        `INSERT INTO mod_packages (id, slug, display_name, kind, ac_content_slug, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [resolvedPackageId, input.slug, input.displayName, input.kind, input.acContentSlug],
      );
    }
    await client.query(
      `INSERT INTO mod_artifacts (id, package_id, version_label, size_bytes, sha256, storage_key, manifest_json, storage_origin, source_edge_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (package_id, sha256) DO UPDATE SET
         storage_key = EXCLUDED.storage_key,
         storage_origin = EXCLUDED.storage_origin,
         source_edge_id = COALESCE(EXCLUDED.source_edge_id, mod_artifacts.source_edge_id),
         manifest_json = EXCLUDED.manifest_json`,
      [
        artifactId,
        resolvedPackageId,
        input.versionLabel,
        input.sizeBytes,
        input.sha256,
        input.storageKey,
        JSON.stringify(input.manifest),
        storageOrigin,
        sourceEdgeId,
      ],
    );
    const art = await client.query<{ id: string }>(
      `SELECT id FROM mod_artifacts WHERE package_id = $1 AND sha256 = $2`,
      [resolvedPackageId, input.sha256],
    );
    await client.query('COMMIT');
    return { packageId: resolvedPackageId, artifactId: art.rows[0]?.id ?? artifactId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark inventory READY after edge-local upload (no install job). */
export async function markArtifactReadyOnEdge(input: {
  edgeId: string;
  artifactId: string;
  packageId: string;
  sha256: string;
  bytesOnDisk?: number;
}): Promise<void> {
  const pool = getModPool();
  const edgeId = input.edgeId.trim().toLowerCase();
  await pool.query(
    `INSERT INTO edge_artifact_assignments (edge_id, artifact_id, package_id, desired_state, assigned_at)
     VALUES ($1, $2, $3, 'present', NOW())
     ON CONFLICT (edge_id, package_id) DO UPDATE SET artifact_id = EXCLUDED.artifact_id, desired_state = 'present', assigned_at = NOW()`,
    [edgeId, input.artifactId, input.packageId],
  );
  await pool.query(
    `INSERT INTO edge_artifact_inventory (edge_id, artifact_id, package_id, status, installed_sha256, bytes_on_disk, progress_pct, updated_at)
     VALUES ($1, $2, $3, 'READY', $4, $5, 100, NOW())
     ON CONFLICT (edge_id, artifact_id) DO UPDATE SET
       status = 'READY',
       installed_sha256 = EXCLUDED.installed_sha256,
       bytes_on_disk = EXCLUDED.bytes_on_disk,
       progress_pct = 100,
       error_code = NULL,
       error_message = NULL,
       updated_at = NOW()`,
    [edgeId, input.artifactId, input.packageId, input.sha256, input.bytesOnDisk ?? null],
  );
}

export async function listPackagesWithLatestArtifact(): Promise<
  Array<ModPackageRow & { latest_artifact?: ModArtifactRow }>
> {
  const pool = getModPool();
  const result = await pool.query<
    ModPackageRow & {
      artifact_id: string | null;
      version_label: string | null;
      size_bytes: string | null;
      sha256: string | null;
      storage_key: string | null;
      manifest_json: ModManifest | null;
      artifact_created_at: Date | null;
    }
  >(
    `SELECT p.*,
            a.id AS artifact_id, a.version_label, a.size_bytes::text, a.sha256, a.storage_key, a.manifest_json, a.created_at AS artifact_created_at
     FROM mod_packages p
     LEFT JOIN LATERAL (
       SELECT * FROM mod_artifacts ma WHERE ma.package_id = p.id ORDER BY ma.created_at DESC LIMIT 1
     ) a ON TRUE
     ORDER BY p.display_name`,
  );
  return result.rows.map((row) => {
    const base: ModPackageRow = {
      id: row.id,
      slug: row.slug,
      display_name: row.display_name,
      kind: row.kind,
      ac_content_slug: row.ac_content_slug,
      notes: row.notes,
      category: row.category ?? null,
      preview_image_filename: row.preview_image_filename ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (!row.artifact_id) {
      return base;
    }
    return {
      ...base,
      latest_artifact: {
        id: row.artifact_id,
        package_id: row.id,
        version_label: row.version_label!,
        size_bytes: row.size_bytes!,
        sha256: row.sha256!,
        storage_key: row.storage_key!,
        manifest_json: row.manifest_json ?? { acContentSlugs: [], kind: row.kind, rootPaths: [] },
        created_at: row.artifact_created_at!,
      },
    };
  });
}

export async function getArtifactById(artifactId: string): Promise<
  (ModArtifactRow & { package: ModPackageRow }) | null
> {
  const pool = getModPool();
  const result = await pool.query(
    `SELECT a.*, p.id AS pkg_id, p.slug, p.display_name, p.kind, p.ac_content_slug, p.notes,
            p.category, p.preview_image_filename, p.created_at AS pkg_created, p.updated_at AS pkg_updated
     FROM mod_artifacts a
     JOIN mod_packages p ON p.id = a.package_id
     WHERE a.id = $1`,
    [artifactId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    package_id: String(row.package_id),
    version_label: String(row.version_label),
    size_bytes: String(row.size_bytes),
    sha256: String(row.sha256),
    storage_key: String(row.storage_key),
    manifest_json: row.manifest_json as ModManifest,
    created_at: row.created_at as Date,
    storage_origin: (row.storage_origin as 'hub' | 'edge' | undefined) ?? 'hub',
    source_edge_id: (row.source_edge_id as string | null | undefined) ?? null,
    package: {
      id: String(row.pkg_id),
      slug: String(row.slug),
      display_name: String(row.display_name),
      kind: row.kind as ModKind,
      ac_content_slug: String(row.ac_content_slug),
      notes: (row.notes as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      preview_image_filename: (row.preview_image_filename as string | null) ?? null,
      created_at: row.pkg_created as Date,
      updated_at: row.pkg_updated as Date,
    },
  };
}

export async function assignArtifactToEdges(
  artifactId: string,
  packageId: string,
  edgeIds: string[],
): Promise<void> {
  const pool = getModPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const edgeId of edgeIds) {
      await client.query(
        `INSERT INTO edge_artifact_assignments (edge_id, artifact_id, package_id, desired_state, assigned_at)
         VALUES ($1, $2, $3, 'present', NOW())
         ON CONFLICT (edge_id, package_id) DO UPDATE SET artifact_id = EXCLUDED.artifact_id, desired_state = 'present', assigned_at = NOW()`,
        [edgeId, artifactId, packageId],
      );
      await client.query(
        `INSERT INTO edge_artifact_inventory (edge_id, artifact_id, package_id, status, progress_pct, updated_at)
         VALUES ($1, $2, $3, 'PENDING', 0, NOW())
         ON CONFLICT (edge_id, artifact_id) DO UPDATE SET status = 'PENDING', progress_pct = 0, error_code = NULL, error_message = NULL, updated_at = NOW()`,
        [edgeId, artifactId, packageId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeArtifactFromEdges(packageId: string, edgeIds: string[]): Promise<void> {
  const pool = getModPool();
  for (const edgeId of edgeIds) {
    await pool.query(
      `UPDATE edge_artifact_assignments SET desired_state = 'absent', assigned_at = NOW() WHERE edge_id = $1 AND package_id = $2`,
      [edgeId, packageId],
    );
  }
}

export async function getDistributionMatrix(artifactId: string): Promise<
  Array<{
    edge_id: string;
    label: string;
    status: EdgeArtifactStatus;
    progress_pct: number;
    phase: string | null;
    jobState: string | null;
    lastSeenAt: string | null;
    installed_sha256: string | null;
    error_message: string | null;
  }>
> {
  const pool = getModPool();
  const art = await getArtifactById(artifactId);
  if (!art) {
    return [];
  }
  const edges = await listFleetEdgesDb();
  const inv = await pool.query<{
    edge_id: string;
    status: EdgeArtifactStatus;
    progress_pct: number;
    installed_sha256: string | null;
    error_message: string | null;
  }>(
    `SELECT edge_id, status, progress_pct, installed_sha256, error_message FROM edge_artifact_inventory WHERE artifact_id = $1`,
    [artifactId],
  );
  const invByEdge = new Map(inv.rows.map((r) => [r.edge_id, r]));
  const assign = await pool.query<{ edge_id: string; desired_state: string }>(
    `SELECT edge_id, desired_state FROM edge_artifact_assignments WHERE package_id = $1`,
    [art.package_id],
  );
  const assignByEdge = new Map(assign.rows.map((r) => [r.edge_id, r.desired_state]));

  const jobs = await pool.query<{
    edge_id: string;
    state: string;
    phase: string | null;
    progress_pct: number;
  }>(
    `SELECT DISTINCT ON (edge_id) edge_id, state, phase, progress_pct
     FROM sync_jobs
     WHERE artifact_id = $1 AND state IN ('queued', 'running', 'failed')
     ORDER BY edge_id,
       CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
       created_at DESC`,
    [artifactId],
  );
  const jobByEdge = new Map(jobs.rows.map((r) => [r.edge_id, r]));

  return edges.map((edge) => {
    const row = invByEdge.get(edge.id);
    const desired = assignByEdge.get(edge.id);
    const job = jobByEdge.get(edge.id);
    let status: EdgeArtifactStatus = 'NOT_INSTALLED';
    if (desired === 'present') {
      if (row) {
        status = row.status;
        if (status === 'READY' && row.installed_sha256 && row.installed_sha256 !== art.sha256) {
          status = 'OUTDATED';
        }
      } else {
        status = 'PENDING';
      }
    }
    const progress =
      job?.state === 'running' || job?.state === 'queued'
        ? Number(job.progress_pct ?? 0)
        : Number(row?.progress_pct ?? 0);
    return {
      edge_id: edge.id,
      label: edge.label,
      status,
      progress_pct: progress,
      phase: job?.phase ?? null,
      jobState: job?.state ?? null,
      lastSeenAt: edge.last_seen_at ? new Date(edge.last_seen_at).toISOString() : null,
      installed_sha256: row?.installed_sha256 ?? null,
      error_message: row?.error_message ?? null,
    };
  });
}

export type FleetSyncIssueRow = {
  edge_id: string;
  edge_label: string;
  last_seen_at: string | null;
  artifact_id: string;
  package_id: string;
  display_name: string;
  kind: ModKind;
  status: EdgeArtifactStatus;
  progress_pct: number;
  phase: string | null;
  jobState: string | null;
  error_message: string | null;
};

/** Cross-mod inventory / jobs that are not happily READY (for Fleet ops overview). */
export async function listFleetSyncIssues(): Promise<FleetSyncIssueRow[]> {
  const pool = getModPool();
  const result = await pool.query<{
    edge_id: string;
    edge_label: string;
    last_seen_at: Date | null;
    artifact_id: string;
    package_id: string;
    display_name: string;
    kind: ModKind;
    status: EdgeArtifactStatus;
    progress_pct: number;
    phase: string | null;
    job_state: string | null;
    error_message: string | null;
  }>(
    `SELECT e.id AS edge_id, e.label AS edge_label, e.last_seen_at,
            inv.artifact_id, inv.package_id, p.display_name, p.kind,
            inv.status, inv.progress_pct, inv.error_message,
            j.state AS job_state, j.phase
     FROM edge_artifact_inventory inv
     JOIN fleet_edges e ON e.id = inv.edge_id
     JOIN mod_packages p ON p.id = inv.package_id
     LEFT JOIN LATERAL (
       SELECT state, phase
       FROM sync_jobs sj
       WHERE sj.artifact_id = inv.artifact_id AND sj.edge_id = inv.edge_id
         AND sj.state IN ('queued', 'running', 'failed')
       ORDER BY CASE sj.state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                sj.created_at DESC
       LIMIT 1
     ) j ON TRUE
     WHERE inv.status IN ('PENDING', 'SYNCING', 'ERROR')
        OR j.state IS NOT NULL
     ORDER BY e.label, p.display_name
     LIMIT 200`,
  );

  return result.rows.map((row) => ({
    edge_id: row.edge_id,
    edge_label: row.edge_label,
    last_seen_at: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    artifact_id: row.artifact_id,
    package_id: row.package_id,
    display_name: row.display_name,
    kind: row.kind,
    status: row.status,
    progress_pct: Number(row.progress_pct) || 0,
    phase: row.phase,
    jobState: row.job_state,
    error_message: row.error_message,
  }));
}

export async function listArtifactsForPackage(packageId: string): Promise<ModArtifactRow[]> {
  const pool = getModPool();
  const result = await pool.query<ModArtifactRow>(
    `SELECT id, package_id, version_label, size_bytes::text, sha256, storage_key, manifest_json, created_at
     FROM mod_artifacts WHERE package_id = $1 ORDER BY created_at DESC`,
    [packageId],
  );
  return result.rows;
}

export async function getPackageById(packageId: string): Promise<ModPackageRow | null> {
  const pool = getModPool();
  const result = await pool.query<ModPackageRow>(
    `SELECT id, slug, display_name, kind, ac_content_slug, notes, category, preview_image_filename, created_at, updated_at
     FROM mod_packages WHERE id = $1`,
    [packageId],
  );
  return result.rows[0] ?? null;
}

export async function setPackagePreviewImageFilename(
  packageId: string,
  filename: string | null,
): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `UPDATE mod_packages SET preview_image_filename = $2, updated_at = NOW() WHERE id = $1`,
    [packageId, filename],
  );
}

export type PackageMetadataPatch = {
  display_name?: string;
  kind?: ModKind;
  ac_content_slug?: string;
  notes?: string | null;
  /** Empty string clears category. */
  category?: string | null;
};

/** Normalize free-form catalog labels (drift, pack, …). */
export function normalizePackageCategory(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > 48) {
    return trimmed.slice(0, 48);
  }
  return trimmed;
}

export async function updatePackageMetadata(
  packageId: string,
  patch: PackageMetadataPatch,
): Promise<ModPackageRow | null> {
  const pool = getModPool();
  const current = await getPackageById(packageId);
  if (!current) return null;

  const displayName =
    typeof patch.display_name === 'string' && patch.display_name.trim()
      ? patch.display_name.trim()
      : current.display_name;
  const kind = patch.kind ?? current.kind;
  const acContentSlug =
    typeof patch.ac_content_slug === 'string' && patch.ac_content_slug.trim()
      ? patch.ac_content_slug.trim()
      : current.ac_content_slug;
  const notes =
    patch.notes === undefined
      ? current.notes
      : patch.notes === null
        ? null
        : String(patch.notes);
  const category =
    patch.category === undefined
      ? current.category
      : normalizePackageCategory(patch.category);

  await pool.query(
    `UPDATE mod_packages
     SET display_name = $2, kind = $3, ac_content_slug = $4, notes = $5, category = $6, updated_at = NOW()
     WHERE id = $1`,
    [packageId, displayName, kind, acContentSlug, notes, category],
  );
  return getPackageById(packageId);
}
