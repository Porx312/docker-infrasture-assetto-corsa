import { getModPool } from './db.js';

/** Steam64 (17 digits starting with 7656119). */
export function isValidSteam64(steamId: string): boolean {
  return /^7656119\d{10}$/.test(steamId.trim());
}

export function normalizeSteamId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function upsertModSteamLink(steamId: string, packageId: string): Promise<void> {
  const pool = getModPool();
  await pool.query(
    `INSERT INTO mod_steam_links (steam_id, package_id, linked_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (steam_id, package_id) DO UPDATE SET linked_at = EXCLUDED.linked_at`,
    [steamId, packageId],
  );
}

export async function countPackageSteamLinks(packageId: string): Promise<number> {
  const pool = getModPool();
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM mod_steam_links WHERE package_id = $1`,
    [packageId],
  );
  return Number(r.rows[0]?.c ?? 0);
}

export async function hasModSteamLink(steamId: string, packageId: string): Promise<boolean> {
  const pool = getModPool();
  const r = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM mod_steam_links WHERE steam_id = $1 AND package_id = $2 LIMIT 1`,
    [steamId, packageId],
  );
  return Boolean(r.rows[0]);
}

export async function deleteModSteamLink(steamId: string, packageId: string): Promise<boolean> {
  const pool = getModPool();
  const r = await pool.query(
    `DELETE FROM mod_steam_links WHERE steam_id = $1 AND package_id = $2`,
    [steamId, packageId],
  );
  return (r.rowCount ?? 0) > 0;
}

export type SteamLinkedModRow = {
  packageId: string;
  slug: string;
  displayName: string;
  kind: string;
  acContentSlug: string;
  category: string | null;
  previewImageFilename: string | null;
  linkedAt: Date;
  artifactId: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
};

export async function listModsForSteam(steamId: string): Promise<SteamLinkedModRow[]> {
  const pool = getModPool();
  const r = await pool.query<{
    package_id: string;
    slug: string;
    display_name: string;
    kind: string;
    ac_content_slug: string;
    category: string | null;
    preview_image_filename: string | null;
    linked_at: Date;
    artifact_id: string | null;
    sha256: string | null;
    size_bytes: string | null;
  }>(
    `SELECT p.id AS package_id, p.slug, p.display_name, p.kind, p.ac_content_slug,
            p.category, p.preview_image_filename, l.linked_at,
            a.id AS artifact_id, a.sha256, a.size_bytes::text
     FROM mod_steam_links l
     JOIN mod_packages p ON p.id = l.package_id
     LEFT JOIN LATERAL (
       SELECT id, sha256, size_bytes
       FROM mod_artifacts
       WHERE package_id = p.id
       ORDER BY created_at DESC
       LIMIT 1
     ) a ON TRUE
     WHERE l.steam_id = $1
     ORDER BY l.linked_at DESC
     LIMIT 500`,
    [steamId],
  );
  return r.rows.map((row) => ({
    packageId: row.package_id,
    slug: row.slug,
    displayName: row.display_name,
    kind: row.kind,
    acContentSlug: row.ac_content_slug,
    category: row.category,
    previewImageFilename: row.preview_image_filename,
    linkedAt: row.linked_at,
    artifactId: row.artifact_id,
    contentHash: row.sha256,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
  }));
}
