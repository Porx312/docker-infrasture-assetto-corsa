import { getModPool } from './db.js';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';
import { ensureFleetEdgeRegistered } from './fleetEdgeDb.js';

export type ServerModRequirementView = {
  acContentSlug: string;
  kind: ModKind;
  packageId: string | null;
  artifactId: string | null;
  displayName: string | null;
  versionLabel: string | null;
  status: string;
};

function normalizeCarToken(raw: string): string {
  return raw.trim();
}

export function parseCarsFromConfig(carsField: string | undefined, entries: Array<{ model?: string }> | undefined): string[] {
  const set = new Set<string>();
  if (carsField) {
    for (const part of carsField.split(/[;,]/)) {
      const token = normalizeCarToken(part);
      if (token) {
        set.add(token);
      }
    }
  }
  if (entries) {
    for (const entry of entries) {
      if (entry.model?.trim()) {
        set.add(entry.model.trim());
      }
    }
  }
  return [...set];
}

export async function resolvePackageForAcSlug(
  acContentSlug: string,
  kind: ModKind,
): Promise<{ packageId: string; artifactId: string | null; displayName: string; versionLabel: string | null } | null> {
  const pool = getModPool();
  const pkg = await pool.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM mod_packages WHERE ac_content_slug = $1 AND kind = $2 LIMIT 1`,
    [acContentSlug, kind],
  );
  const packageRow = pkg.rows[0];
  if (!packageRow) {
    return null;
  }
  const art = await pool.query<{ id: string; version_label: string }>(
    `SELECT id, version_label FROM mod_artifacts WHERE package_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [packageRow.id],
  );
  return {
    packageId: packageRow.id,
    artifactId: art.rows[0]?.id ?? null,
    displayName: packageRow.display_name,
    versionLabel: art.rows[0]?.version_label ?? null,
  };
}

export async function refreshServerModRequirements(input: {
  serverName: string;
  edgeId: string;
  track?: string;
  cars?: string;
  entries?: Array<{ model?: string }>;
}): Promise<void> {
  const edgeId = await ensureFleetEdgeRegistered(input.edgeId);
  const pool = getModPool();
  const slugs: Array<{ acContentSlug: string; kind: ModKind }> = [];
  if (input.track?.trim()) {
    slugs.push({ acContentSlug: input.track.trim(), kind: 'track' });
  }
  for (const car of parseCarsFromConfig(input.cars, input.entries)) {
    slugs.push({ acContentSlug: car, kind: 'car' });
  }

  await pool.query(`DELETE FROM server_mod_requirements WHERE server_name = $1 AND edge_id = $2`, [
    input.serverName,
    edgeId,
  ]);

  for (const row of slugs) {
    const resolved = await resolvePackageForAcSlug(row.acContentSlug, row.kind);
    await pool.query(
      `INSERT INTO server_mod_requirements (server_name, edge_id, package_id, artifact_id, ac_content_slug, kind, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        input.serverName,
        edgeId,
        resolved?.packageId ?? null,
        resolved?.artifactId ?? null,
        row.acContentSlug,
        row.kind,
      ],
    );
  }
}

export async function getServerModReadiness(
  serverName: string,
  edgeId: string,
): Promise<{ ready: boolean; items: ServerModRequirementView[] }> {
  const pool = getModPool();
  const reqs = await pool.query<{
    ac_content_slug: string;
    kind: ModKind;
    package_id: string | null;
    artifact_id: string | null;
  }>(
    `SELECT ac_content_slug, kind, package_id, artifact_id FROM server_mod_requirements WHERE server_name = $1 AND edge_id = $2`,
    [serverName, edgeId],
  );

  const items: ServerModRequirementView[] = [];
  let ready = true;

  for (const req of reqs.rows) {
    let displayName: string | null = null;
    let versionLabel: string | null = null;
    let status = 'NOT_INSTALLED';

    if (!req.artifact_id) {
      ready = false;
      items.push({
        acContentSlug: req.ac_content_slug,
        kind: req.kind,
        packageId: req.package_id,
        artifactId: null,
        displayName,
        versionLabel,
        status: 'UNKNOWN_PACKAGE',
      });
      continue;
    }

    const art = await pool.query<{ version_label: string; display_name: string; sha256: string }>(
      `SELECT a.version_label, p.display_name, a.sha256
       FROM mod_artifacts a JOIN mod_packages p ON p.id = a.package_id WHERE a.id = $1`,
      [req.artifact_id],
    );
    const artRow = art.rows[0];
    displayName = artRow?.display_name ?? null;
    versionLabel = artRow?.version_label ?? null;

    const inv = await pool.query<{ status: string; installed_sha256: string | null }>(
      `SELECT status, installed_sha256 FROM edge_artifact_inventory WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, req.artifact_id],
    );
    const invRow = inv.rows[0];
    if (!invRow) {
      status = 'NOT_INSTALLED';
      ready = false;
    } else {
      status = invRow.status;
      if (status === 'READY' && artRow && invRow.installed_sha256 !== artRow.sha256) {
        status = 'OUTDATED';
      }
      if (status !== 'READY') {
        ready = false;
      }
    }

    items.push({
      acContentSlug: req.ac_content_slug,
      kind: req.kind,
      packageId: req.package_id,
      artifactId: req.artifact_id,
      displayName,
      versionLabel,
      status,
    });
  }

  return { ready, items };
}

export async function syncMissingModsForServer(serverName: string, edgeId: string): Promise<number> {
  const readiness = await getServerModReadiness(serverName, edgeId);
  const { distributeArtifact } = await import('./orchestrator.js');
  let enqueued = 0;
  for (const item of readiness.items) {
    if (item.status === 'READY' || !item.artifactId) {
      continue;
    }
    const result = await distributeArtifact(item.artifactId, [edgeId]);
    enqueued += result.enqueued;
  }
  return enqueued;
}
