import { getModPool } from './db.js';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';
import { ensureFleetEdgeRegistered } from './fleetEdgeDb.js';
import { getModsCars, getModsTracks } from '../controlApi/modsInventory.js';

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

export function parseCarsFromConfig(
  carsField: string | undefined,
  entries: Array<{ model?: string }> | undefined,
): string[] {
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
): Promise<{
  packageId: string;
  artifactId: string | null;
  displayName: string;
  versionLabel: string | null;
} | null> {
  const pool = getModPool();
  const slug = acContentSlug.trim();
  if (!slug) {
    return null;
  }
  const pkg = await pool.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM mod_packages
     WHERE kind = $2
       AND (
         lower(ac_content_slug) = lower($1)
         OR lower(slug) = lower($1)
       )
     ORDER BY
       CASE WHEN lower(ac_content_slug) = lower($1) THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 1`,
    [slug, kind],
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

type LocalInventoryIndex = {
  cars: Map<string, { displayName?: string; artifactId?: string; version?: string }>;
  tracks: Map<string, { artifactId?: string; version?: string }>;
};

async function loadLocalInventoryIndex(edgeId: string): Promise<LocalInventoryIndex> {
  const cars = new Map<string, { displayName?: string; artifactId?: string; version?: string }>();
  const tracks = new Map<string, { artifactId?: string; version?: string }>();
  const [carSnap, trackSnap] = await Promise.all([getModsCars(edgeId), getModsTracks(edgeId)]);
  for (const c of carSnap?.cars ?? []) {
    const key = String(c.carModel || '')
      .trim()
      .toLowerCase();
    if (!key) continue;
    cars.set(key, {
      displayName: c.displayName,
      artifactId: c.artifactId,
      version: c.version,
    });
  }
  for (const t of trackSnap?.tracks ?? []) {
    const key = String(t.trackSlug || '')
      .trim()
      .toLowerCase();
    if (!key) continue;
    tracks.set(key, {
      artifactId: t.artifactId,
      version: t.version,
    });
  }
  return { cars, tracks };
}

function localHit(
  index: LocalInventoryIndex,
  kind: ModKind,
  acContentSlug: string,
): { displayName?: string; artifactId?: string; version?: string } | null {
  const key = acContentSlug.trim().toLowerCase();
  if (!key) return null;
  if (kind === 'car') return index.cars.get(key) ?? null;
  if (kind === 'track') return index.tracks.get(key) ?? null;
  return null;
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

  const local = await loadLocalInventoryIndex(edgeId);

  await pool.query(`DELETE FROM server_mod_requirements WHERE server_name = $1 AND edge_id = $2`, [
    input.serverName,
    edgeId,
  ]);

  for (const row of slugs) {
    const resolved = await resolvePackageForAcSlug(row.acContentSlug, row.kind);
    const hit = localHit(local, row.kind, row.acContentSlug);
    // Only persist artifactId when it exists in mod_artifacts (FK). Inventory-only
    // mods stay null here and are marked READY at readiness time via Redis scan.
    let artifactId = resolved?.artifactId ?? null;
    if (!artifactId && hit?.artifactId) {
      const exists = await pool.query<{ id: string }>(
        `SELECT id FROM mod_artifacts WHERE id = $1`,
        [hit.artifactId],
      );
      if (exists.rows[0]) {
        artifactId = hit.artifactId;
      }
    }
    const packageId = resolved?.packageId ?? null;
    await pool.query(
      `INSERT INTO server_mod_requirements (server_name, edge_id, package_id, artifact_id, ac_content_slug, kind, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [input.serverName, edgeId, packageId, artifactId, row.acContentSlug, row.kind],
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

  const local = await loadLocalInventoryIndex(edgeId);
  const items: ServerModRequirementView[] = [];
  let ready = true;

  for (const req of reqs.rows) {
    let displayName: string | null = null;
    let versionLabel: string | null = null;
    let status = 'NOT_INSTALLED';
    let artifactId = req.artifact_id;
    let packageId = req.package_id;
    const hit = localHit(local, req.kind, req.ac_content_slug);

    // Prefer hub artifact resolution; fall back to inventory presence.
    if (!artifactId) {
      const resolved = await resolvePackageForAcSlug(req.ac_content_slug, req.kind);
      if (resolved) {
        packageId = resolved.packageId;
        artifactId = resolved.artifactId;
        displayName = resolved.displayName;
        versionLabel = resolved.versionLabel;
      } else if (hit?.artifactId) {
        const exists = await pool.query<{ id: string }>(
          `SELECT id FROM mod_artifacts WHERE id = $1`,
          [hit.artifactId],
        );
        if (exists.rows[0]) {
          artifactId = hit.artifactId;
        }
      }
    }

    if (artifactId) {
      const art = await pool.query<{ version_label: string; display_name: string; sha256: string }>(
        `SELECT a.version_label, p.display_name, a.sha256
         FROM mod_artifacts a JOIN mod_packages p ON p.id = a.package_id WHERE a.id = $1`,
        [artifactId],
      );
      const artRow = art.rows[0];
      if (artRow) {
        displayName = artRow.display_name;
        versionLabel = artRow.version_label;
      }

      const inv = await pool.query<{ status: string; installed_sha256: string | null }>(
        `SELECT status, installed_sha256 FROM edge_artifact_inventory WHERE edge_id = $1 AND artifact_id = $2`,
        [edgeId, artifactId],
      );
      const invRow = inv.rows[0];
      if (invRow) {
        status = invRow.status;
        if (status === 'READY' && artRow && invRow.installed_sha256 !== artRow.sha256) {
          status = 'OUTDATED';
        }
      } else if (hit) {
        // On disk via inventory scan even if edge_artifact_inventory row is missing.
        status = 'READY';
        displayName = displayName || hit.displayName || req.ac_content_slug;
        versionLabel = versionLabel || hit.version || null;
      } else {
        status = 'NOT_INSTALLED';
      }
    } else if (hit) {
      // Present on VPS content pool (Cars/Tracks inventory) — usable without hub catalog row.
      status = 'READY';
      displayName = hit.displayName || req.ac_content_slug;
      versionLabel = hit.version || null;
    } else {
      status = 'UNKNOWN_PACKAGE';
    }

    if (status !== 'READY') {
      ready = false;
    }

    items.push({
      acContentSlug: req.ac_content_slug,
      kind: req.kind,
      packageId,
      artifactId,
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
