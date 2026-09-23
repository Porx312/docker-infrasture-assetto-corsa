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
};

export type FleetEdgeRow = {
  id: string;
  label: string;
  base_url: string;
  enabled: boolean;
  last_seen_at: Date | null;
  disk_free_bytes: string | null;
};

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
    `SELECT id, label, base_url, enabled, last_seen_at, disk_free_bytes::text FROM fleet_edges ORDER BY label`,
  );
  return result.rows;
}

export async function setFleetEdgeEnabled(id: string, enabled: boolean): Promise<void> {
  const pool = getModPool();
  await pool.query(`UPDATE fleet_edges SET enabled = $2, updated_at = NOW() WHERE id = $1`, [id, enabled]);
}

export async function recordEdgeHeartbeat(
  edgeId: string,
  diskFreeBytes?: number,
): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `UPDATE fleet_edges SET last_seen_at = NOW(), disk_free_bytes = COALESCE($2, disk_free_bytes), updated_at = NOW() WHERE id = $1`,
    [edgeId, diskFreeBytes ?? null],
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
}): Promise<{ packageId: string; artifactId: string }> {
  const pool = getModPool();
  const artifactId = randomUUID();
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
      `INSERT INTO mod_artifacts (id, package_id, version_label, size_bytes, sha256, storage_key, manifest_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (package_id, sha256) DO NOTHING`,
      [
        artifactId,
        resolvedPackageId,
        input.versionLabel,
        input.sizeBytes,
        input.sha256,
        input.storageKey,
        JSON.stringify(input.manifest),
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
    `SELECT a.*, p.id AS pkg_id, p.slug, p.display_name, p.kind, p.ac_content_slug, p.notes, p.created_at AS pkg_created, p.updated_at AS pkg_updated
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
    package: {
      id: String(row.pkg_id),
      slug: String(row.slug),
      display_name: String(row.display_name),
      kind: row.kind as ModKind,
      ac_content_slug: String(row.ac_content_slug),
      notes: (row.notes as string | null) ?? null,
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

  return edges.map((edge) => {
    const row = invByEdge.get(edge.id);
    const desired = assignByEdge.get(edge.id);
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
    return {
      edge_id: edge.id,
      label: edge.label,
      status,
      progress_pct: row?.progress_pct ?? 0,
      installed_sha256: row?.installed_sha256 ?? null,
      error_message: row?.error_message ?? null,
    };
  });
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
