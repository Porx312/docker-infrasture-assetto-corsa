import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';
import { getModPool, isModDbConfigured } from './db.js';
import { ensureArtifactOnEdge } from './orchestrator.js';
import { modPreviewPublicUrl } from './modPreviewImages.js';
import { getModsCars, getModsTracks } from '../controlApi/modsInventory.js';

export type CentralModVersion = {
  version: string;
  artifactId: string;
  sha256: string;
  size: number;
};

export type CentralModPackage = {
  id: string;
  slug: string;
  kind: ModKind;
  name: string;
  acContentSlug: string;
  imageUrl: string | null;
  versions: CentralModVersion[];
};

export type LocalAvailabilityStatus =
  | 'LOCAL'
  | 'MISSING'
  | 'DOWNLOADING'
  | 'INSTALLING'
  | 'ERROR';

export type ModAvailabilityItem = {
  modId: string;
  slug: string;
  kind: ModKind;
  name: string;
  acContentSlug: string;
  version: string;
  artifactId: string;
  sha256: string;
  size: number;
  /** Artifact exists in the central library. */
  central: 'AVAILABLE';
  /** Materialization / sync state on the target VPS. */
  local: LocalAvailabilityStatus;
  jobId?: string;
  errorMessage?: string | null;
  /** From VPS inventory when local === LOCAL (cars). */
  skins?: string[];
  /** From VPS inventory when local === LOCAL (tracks); "" = default layout. */
  configs?: string[];
};

export type EnsureModRef = {
  modId: string;
  version?: string;
};

export type EnsureRequest = {
  artifactIds?: string[];
  cars?: EnsureModRef[];
  tracks?: EnsureModRef[];
};

export type EnsureItemResult = {
  artifactId: string;
  modId?: string;
  slug?: string;
  version?: string;
  sha256?: string;
  status: 'LOCAL' | 'QUEUED' | 'DOWNLOADING' | 'INSTALLING' | 'ERROR' | 'NOT_FOUND';
  jobId?: string;
  errorMessage?: string;
};

function mapPackageRow(row: {
  id: string;
  slug: string;
  kind: ModKind;
  display_name: string;
  ac_content_slug: string;
  preview_image_filename?: string | null;
  versions: Array<{
    version: string;
    artifactId: string;
    sha256: string;
    size: string | number;
  }>;
}): CentralModPackage {
  const filename =
    typeof row.preview_image_filename === 'string' && row.preview_image_filename.trim()
      ? row.preview_image_filename.trim()
      : null;
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.display_name,
    acContentSlug: row.ac_content_slug,
    imageUrl: filename ? modPreviewPublicUrl(filename) : null,
    versions: row.versions.map((v) => ({
      version: v.version,
      artifactId: v.artifactId,
      sha256: v.sha256,
      size: Number(v.size),
    })),
  };
}

export async function listCentralMods(kind?: ModKind): Promise<CentralModPackage[]> {
  const pool = getModPool();
  const params: unknown[] = [];
  let kindClause = '';
  if (kind) {
    params.push(kind);
    kindClause = `WHERE p.kind = $1`;
  }
  const result = await pool.query<{
    id: string;
    slug: string;
    kind: ModKind;
    display_name: string;
    ac_content_slug: string;
    preview_image_filename: string | null;
    versions: unknown;
  }>(
    `SELECT p.id, p.slug, p.kind, p.display_name, p.ac_content_slug, p.preview_image_filename,
            COALESCE(
              json_agg(
                json_build_object(
                  'version', a.version_label,
                  'artifactId', a.id,
                  'sha256', a.sha256,
                  'size', a.size_bytes
                )
                ORDER BY a.created_at DESC
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'::json
            ) AS versions
     FROM mod_packages p
     LEFT JOIN mod_artifacts a ON a.package_id = p.id
     ${kindClause}
     GROUP BY p.id
     ORDER BY p.display_name`,
    params,
  );
  return result.rows.map((row) =>
    mapPackageRow({
      ...row,
      versions: Array.isArray(row.versions) ? (row.versions as CentralModVersion[]) : [],
    }),
  );
}

export async function getCentralModBySlug(slug: string): Promise<CentralModPackage | null> {
  const pool = getModPool();
  const result = await pool.query<{
    id: string;
    slug: string;
    kind: ModKind;
    display_name: string;
    ac_content_slug: string;
    preview_image_filename: string | null;
    versions: unknown;
  }>(
    `SELECT p.id, p.slug, p.kind, p.display_name, p.ac_content_slug, p.preview_image_filename,
            COALESCE(
              json_agg(
                json_build_object(
                  'version', a.version_label,
                  'artifactId', a.id,
                  'sha256', a.sha256,
                  'size', a.size_bytes
                )
                ORDER BY a.created_at DESC
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'::json
            ) AS versions
     FROM mod_packages p
     LEFT JOIN mod_artifacts a ON a.package_id = p.id
     WHERE p.slug = $1 OR p.ac_content_slug = $1
     GROUP BY p.id
     LIMIT 1`,
    [slug.trim()],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapPackageRow({
    ...row,
    versions: Array.isArray(row.versions) ? (row.versions as CentralModVersion[]) : [],
  });
}

function deriveLocalStatus(input: {
  inventoryStatus: string | null;
  installedSha256: string | null;
  expectedSha256: string;
  jobState: string | null;
  jobPhase: string | null;
  errorMessage: string | null;
}): LocalAvailabilityStatus {
  const { inventoryStatus, installedSha256, expectedSha256, jobState, jobPhase, errorMessage } =
    input;

  if (inventoryStatus === 'READY' && installedSha256 && installedSha256 === expectedSha256) {
    return 'LOCAL';
  }

  if (jobState === 'queued' || jobState === 'running') {
    const phase = (jobPhase || '').toLowerCase();
    if (phase.includes('extract') || phase.includes('install') || phase.includes('material')) {
      return 'INSTALLING';
    }
    return 'DOWNLOADING';
  }

  if (
    inventoryStatus === 'ERROR' ||
    jobState === 'failed' ||
    (inventoryStatus === 'READY' && installedSha256 && installedSha256 !== expectedSha256)
  ) {
    return 'ERROR';
  }

  if (errorMessage && inventoryStatus === 'ERROR') {
    return 'ERROR';
  }

  return 'MISSING';
}

export async function getModsAvailability(instanceId: string): Promise<{
  instanceId: string;
  edgeId: string;
  items: ModAvailabilityItem[];
}> {
  const edge = resolveFleetEdgeByInstanceId(instanceId);
  if (!edge) {
    throw new Error('fleet_edge_not_found');
  }
  const edgeId = edge.id.toLowerCase();
  const pool = getModPool();

  const arts = await pool.query<{
    package_id: string;
    slug: string;
    kind: ModKind;
    display_name: string;
    ac_content_slug: string;
    version_label: string;
    artifact_id: string;
    sha256: string;
    size_bytes: string;
    inv_status: string | null;
    installed_sha256: string | null;
    inv_error: string | null;
    job_id: string | null;
    job_state: string | null;
    job_phase: string | null;
  }>(
    `SELECT p.id AS package_id, p.slug, p.kind, p.display_name, p.ac_content_slug,
            a.version_label, a.id AS artifact_id, a.sha256, a.size_bytes::text,
            inv.status AS inv_status, inv.installed_sha256, inv.error_message AS inv_error,
            j.id AS job_id, j.state AS job_state, j.phase AS job_phase
     FROM mod_artifacts a
     JOIN mod_packages p ON p.id = a.package_id
     LEFT JOIN edge_artifact_inventory inv
       ON inv.artifact_id = a.id AND inv.edge_id = $1
     LEFT JOIN LATERAL (
       SELECT sj.id, sj.state, sj.phase
       FROM sync_jobs sj
       WHERE sj.edge_id = $1 AND sj.artifact_id = a.id
         AND sj.state IN ('queued', 'running', 'failed')
       ORDER BY CASE sj.state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                sj.created_at DESC
       LIMIT 1
     ) j ON TRUE
     ORDER BY p.display_name, a.created_at DESC`,
    [edgeId],
  );

  const carsSnap = await getModsCars(instanceId);
  const tracksSnap = await getModsTracks(instanceId);
  const skinsByModel = new Map<string, string[]>();
  for (const car of carsSnap?.cars ?? []) {
    const model = (car.carModel || '').trim();
    if (model) {
      skinsByModel.set(model, Array.isArray(car.skins) ? car.skins : []);
    }
  }
  const configsByTrack = new Map<string, string[]>();
  for (const track of tracksSnap?.tracks ?? []) {
    const slug = (track.trackSlug || '').trim();
    if (slug) {
      configsByTrack.set(slug, Array.isArray(track.configs) ? track.configs : ['']);
    }
  }

  const items: ModAvailabilityItem[] = arts.rows.map((row) => {
    const local = deriveLocalStatus({
      inventoryStatus: row.inv_status,
      installedSha256: row.installed_sha256,
      expectedSha256: row.sha256,
      jobState: row.job_state,
      jobPhase: row.job_phase,
      errorMessage: row.inv_error,
    });
    const acContentSlug = row.ac_content_slug;
    const item: ModAvailabilityItem = {
      modId: row.package_id,
      slug: row.slug,
      kind: row.kind,
      name: row.display_name,
      acContentSlug,
      version: row.version_label,
      artifactId: row.artifact_id,
      sha256: row.sha256,
      size: Number(row.size_bytes),
      central: 'AVAILABLE',
      local,
      ...(row.job_id && (local === 'DOWNLOADING' || local === 'INSTALLING')
        ? { jobId: row.job_id }
        : {}),
      ...(local === 'ERROR' ? { errorMessage: row.inv_error } : {}),
    };
    if (local === 'LOCAL') {
      if (row.kind === 'car') {
        const skins = skinsByModel.get(acContentSlug);
        if (skins) {
          item.skins = skins;
        }
      } else if (row.kind === 'track') {
        const configs = configsByTrack.get(acContentSlug);
        if (configs) {
          item.configs = configs;
        }
      }
    }
    return item;
  });

  return { instanceId: instanceId.trim(), edgeId, items };
}

async function resolveArtifactId(
  modId: string,
  version: string | undefined,
  kindHint?: ModKind,
): Promise<{
  artifactId: string;
  packageId: string;
  slug: string;
  version: string;
  sha256: string;
} | null> {
  const pool = getModPool();
  const id = modId.trim();
  if (!id) {
    return null;
  }

  // Direct artifact UUID
  const asArtifact = await pool.query<{
    id: string;
    package_id: string;
    version_label: string;
    sha256: string;
    slug: string;
  }>(
    `SELECT a.id, a.package_id, a.version_label, a.sha256, p.slug
     FROM mod_artifacts a JOIN mod_packages p ON p.id = a.package_id
     WHERE a.id::text = $1`,
    [id],
  );
  if (asArtifact.rows[0]) {
    const row = asArtifact.rows[0];
    return {
      artifactId: row.id,
      packageId: row.package_id,
      slug: row.slug,
      version: row.version_label,
      sha256: row.sha256,
    };
  }

  const pkg = await pool.query<{ id: string; slug: string; kind: ModKind }>(
    `SELECT id, slug, kind FROM mod_packages
     WHERE id::text = $1 OR slug = $1 OR ac_content_slug = $1
     ${kindHint ? 'AND kind = $2' : ''}
     LIMIT 1`,
    kindHint ? [id, kindHint] : [id],
  );
  const packageRow = pkg.rows[0];
  if (!packageRow) {
    return null;
  }

  if (version?.trim()) {
    const art = await pool.query<{ id: string; version_label: string; sha256: string }>(
      `SELECT id, version_label, sha256 FROM mod_artifacts
       WHERE package_id = $1 AND version_label = $2
       ORDER BY created_at DESC LIMIT 1`,
      [packageRow.id, version.trim()],
    );
    if (!art.rows[0]) {
      return null;
    }
    return {
      artifactId: art.rows[0].id,
      packageId: packageRow.id,
      slug: packageRow.slug,
      version: art.rows[0].version_label,
      sha256: art.rows[0].sha256,
    };
  }

  const latest = await pool.query<{ id: string; version_label: string; sha256: string }>(
    `SELECT id, version_label, sha256 FROM mod_artifacts
     WHERE package_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [packageRow.id],
  );
  if (!latest.rows[0]) {
    return null;
  }
  return {
    artifactId: latest.rows[0].id,
    packageId: packageRow.id,
    slug: packageRow.slug,
    version: latest.rows[0].version_label,
    sha256: latest.rows[0].sha256,
  };
}

async function collectEnsureTargets(body: EnsureRequest): Promise<
  Array<{
    artifactId: string;
    packageId: string;
    slug: string;
    version: string;
    sha256: string;
  }>
> {
  const out: Array<{
    artifactId: string;
    packageId: string;
    slug: string;
    version: string;
    sha256: string;
  }> = [];
  const seen = new Set<string>();

  const push = async (
    modId: string,
    version: string | undefined,
    kindHint?: ModKind,
  ): Promise<void> => {
    const resolved = await resolveArtifactId(modId, version, kindHint);
    if (!resolved || seen.has(resolved.artifactId)) {
      if (!resolved) {
        out.push({
          artifactId: modId,
          packageId: '',
          slug: '',
          version: version || '',
          sha256: '',
        });
      }
      return;
    }
    seen.add(resolved.artifactId);
    out.push(resolved);
  };

  for (const id of body.artifactIds ?? []) {
    if (typeof id === 'string' && id.trim()) {
      await push(id.trim(), undefined);
    }
  }
  for (const ref of body.cars ?? []) {
    if (ref?.modId) {
      await push(ref.modId, ref.version, 'car');
    }
  }
  for (const ref of body.tracks ?? []) {
    if (ref?.modId) {
      await push(ref.modId, ref.version, 'track');
    }
  }
  return out;
}

export async function ensureModsOnInstance(
  instanceId: string,
  body: EnsureRequest,
): Promise<{ instanceId: string; edgeId: string; items: EnsureItemResult[] }> {
  if (!isModDbConfigured()) {
    throw new Error('database_unavailable');
  }
  const edge = resolveFleetEdgeByInstanceId(instanceId);
  if (!edge) {
    throw new Error('fleet_edge_not_found');
  }
  const edgeId = edge.id.toLowerCase();
  const targets = await collectEnsureTargets(body);
  const pool = getModPool();
  const items: EnsureItemResult[] = [];

  for (const target of targets) {
    if (!target.sha256 || !target.packageId) {
      // Unresolved in hub catalog — still LOCAL if present on VPS content inventory.
      const slugHint = (target.slug || target.artifactId || '').trim().toLowerCase();
      let onDisk = false;
      if (slugHint) {
        const [carsSnap, tracksSnap] = await Promise.all([
          getModsCars(edgeId),
          getModsTracks(edgeId),
        ]);
        onDisk =
          (carsSnap?.cars ?? []).some(
            (c) => String(c.carModel || '').trim().toLowerCase() === slugHint,
          ) ||
          (tracksSnap?.tracks ?? []).some(
            (t) => String(t.trackSlug || '').trim().toLowerCase() === slugHint,
          );
      }
      if (onDisk) {
        items.push({
          artifactId: target.artifactId,
          slug: target.slug || target.artifactId,
          status: 'LOCAL',
        });
        continue;
      }
      items.push({
        artifactId: target.artifactId,
        status: 'NOT_FOUND',
        errorMessage: 'artifact_not_in_central_library',
      });
      continue;
    }

    const inv = await pool.query<{ status: string; installed_sha256: string | null }>(
      `SELECT status, installed_sha256 FROM edge_artifact_inventory
       WHERE edge_id = $1 AND artifact_id = $2`,
      [edgeId, target.artifactId],
    );
    const invRow = inv.rows[0];
    if (
      invRow?.status === 'READY' &&
      invRow.installed_sha256 &&
      invRow.installed_sha256 === target.sha256
    ) {
      items.push({
        artifactId: target.artifactId,
        modId: target.packageId,
        slug: target.slug,
        version: target.version,
        sha256: target.sha256,
        status: 'LOCAL',
      });
      continue;
    }

    const { jobId, created } = await ensureArtifactOnEdge(target.artifactId, edgeId);
    const active = await pool.query<{ state: string; phase: string | null }>(
      `SELECT state, phase FROM sync_jobs WHERE id = $1`,
      [jobId],
    );
    const state = active.rows[0]?.state;
    const phase = (active.rows[0]?.phase || '').toLowerCase();
    let status: EnsureItemResult['status'] = created ? 'QUEUED' : 'QUEUED';
    if (state === 'running') {
      status =
        phase.includes('extract') || phase.includes('install') ? 'INSTALLING' : 'DOWNLOADING';
    } else if (state === 'failed') {
      status = 'ERROR';
    }

    items.push({
      artifactId: target.artifactId,
      modId: target.packageId,
      slug: target.slug,
      version: target.version,
      sha256: target.sha256,
      status,
      jobId,
    });
  }

  return { instanceId: instanceId.trim(), edgeId, items };
}

/** Resolve track/car slugs from a config snapshot into ensure targets (latest version). */
export async function resolveConfigModTargets(config: {
  track?: string;
  cars?: string;
  entries?: Array<{ model?: string }>;
}): Promise<EnsureRequest> {
  const cars: EnsureModRef[] = [];
  const tracks: EnsureModRef[] = [];
  if (config.track?.trim()) {
    tracks.push({ modId: config.track.trim() });
  }
  const carSet = new Set<string>();
  if (config.cars) {
    for (const part of config.cars.split(/[;,]/)) {
      const token = part.trim();
      if (token) {
        carSet.add(token);
      }
    }
  }
  for (const entry of config.entries ?? []) {
    const model = entry.model?.trim();
    if (model) {
      carSet.add(model);
    }
  }
  for (const model of carSet) {
    cars.push({ modId: model });
  }
  return { cars, tracks };
}

export async function waitUntilModsLocal(
  instanceId: string,
  artifactIds: string[],
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<{ ready: boolean; items: EnsureItemResult[] }> {
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.MOD_ENSURE_WAIT_MS || 120_000);
  const pollMs = opts?.pollMs ?? Number(process.env.MOD_ENSURE_POLL_MS || 2_000);
  const deadline = Date.now() + timeoutMs;
  let last: EnsureItemResult[] = [];

  while (Date.now() <= deadline) {
    const result = await ensureModsOnInstance(instanceId, { artifactIds });
    last = result.items;
    const allLocal = last.every((item) => item.status === 'LOCAL');
    if (allLocal) {
      return { ready: true, items: last };
    }
    if (last.some((item) => item.status === 'ERROR' || item.status === 'NOT_FOUND')) {
      return { ready: false, items: last };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ready: false, items: last };
}

/** Pure helpers exported for unit tests. */
export const _test = {
  deriveLocalStatus,
  mapPackageRow,
};
