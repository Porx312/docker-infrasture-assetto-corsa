import { getModPool } from './db.js';

export type GcCandidate = {
  edgeId: string;
  edgeLabel: string;
  artifactId: string;
  packageDisplayName: string;
  acContentSlug: string;
  refCount: number;
  bytesOnDisk: number | null;
};

export async function listGcCandidates(): Promise<GcCandidate[]> {
  const pool = getModPool();
  const result = await pool.query<{
    edge_id: string;
    label: string;
    artifact_id: string;
    display_name: string;
    ac_content_slug: string;
    ref_count: string;
    bytes_on_disk: string | null;
  }>(
    `SELECT e.id AS edge_id, e.label, inv.artifact_id, p.display_name, p.ac_content_slug,
            (
              SELECT COUNT(*)::text FROM server_mod_requirements r
              WHERE r.edge_id = inv.edge_id AND r.artifact_id = inv.artifact_id
            ) AS ref_count,
            inv.bytes_on_disk::text
     FROM edge_artifact_inventory inv
     JOIN fleet_edges e ON e.id = inv.edge_id
     JOIN mod_artifacts a ON a.id = inv.artifact_id
     JOIN mod_packages p ON p.id = a.package_id
     WHERE inv.status = 'READY'`,
  );

  return result.rows
    .filter((row) => Number(row.ref_count) === 0)
    .map((row) => ({
      edgeId: row.edge_id,
      edgeLabel: row.label,
      artifactId: row.artifact_id,
      packageDisplayName: row.display_name,
      acContentSlug: row.ac_content_slug,
      refCount: Number(row.ref_count),
      bytesOnDisk: row.bytes_on_disk ? Number(row.bytes_on_disk) : null,
    }));
}

export async function runGcOnEdge(edgeId: string, artifactIds: string[]): Promise<number> {
  const { removePackageFromEdges } = await import('./orchestrator.js');
  const pool = getModPool();
  let count = 0;
  for (const artifactId of artifactIds) {
    const art = await pool.query<{ package_id: string }>(
      `SELECT package_id FROM mod_artifacts WHERE id = $1`,
      [artifactId],
    );
    const packageId = art.rows[0]?.package_id;
    if (!packageId) {
      continue;
    }
    const refs = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM server_mod_requirements WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, artifactId],
    );
    if (Number(refs.rows[0]?.c ?? 0) > 0) {
      continue;
    }
    await removePackageFromEdges(packageId, [edgeId]);
    count += 1;
  }
  return count;
}
