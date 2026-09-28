import fs from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';

function inferKindFromPaths(paths: string[]): ModKind {
  const normalized = paths.map((p) => p.replace(/\\/g, '/').toLowerCase());
  if (normalized.some((p) => p.includes('/cars/') || p.startsWith('cars/'))) {
    return 'car';
  }
  if (normalized.some((p) => p.includes('/tracks/') || p.startsWith('tracks/'))) {
    return 'track';
  }
  if (normalized.some((p) => p.includes('/weather/') || p.startsWith('weather/'))) {
    return 'weather';
  }
  return 'misc';
}

function contentFolderForKind(kind: ModKind): 'cars' | 'tracks' | 'weather' | undefined {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  if (kind === 'weather') return 'weather';
  return undefined;
}

function extractAcSlugs(paths: string[], kind: ModKind): string[] {
  const folder = contentFolderForKind(kind);
  if (!folder) {
    return [];
  }
  const slugs = new Set<string>();
  const prefix = `${folder}/`;
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    if (!p.startsWith(prefix)) {
      continue;
    }
    const rest = p.slice(prefix.length);
    const slug = rest.split('/')[0];
    if (slug && !slug.includes('..')) {
      slugs.add(slug);
    }
  }
  return [...slugs];
}

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_EMPTY = 0x06054b50;
const ZIP_SPANNING = 0x08074b50;

export async function assertValidZipFile(zipPath: string): Promise<void> {
  const handle = await fs.promises.open(zipPath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buf, 0, 4, 0);
    if (bytesRead < 4) {
      throw new Error('Upload is empty or incomplete. Try uploading the ZIP again.');
    }
    const sig = buf.readUInt32LE(0);
    const valid =
      sig === ZIP_LOCAL_HEADER || sig === ZIP_EMPTY || sig === ZIP_SPANNING || sig === 0x02014b50;
    if (!valid) {
      throw new Error(
        'Not a valid ZIP file (wrong format or truncated upload). Re-export as .zip (7-Zip / Windows) — not .rar or .7z.',
      );
    }
  } finally {
    await handle.close();
  }
}

/** Inspect zip entries without full extract (for finalize). */
export async function buildManifestFromZip(zipPath: string, kindHint?: ModKind): Promise<ModManifest> {
  await assertValidZipFile(zipPath);
  const paths: string[] = [];
  try {
    const archive = await unzipper.Open.file(zipPath);
    const entries = (archive as { files?: Array<{ path: string }> }).files ?? [];
    for (const entry of entries) {
      if (entry.path) {
        paths.push(entry.path);
      }
    }
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.includes('invalid signature')) {
      throw new Error(
        'ZIP could not be read (corrupt or unsupported layout). Re-compress the mod folder as a standard .zip and upload again.',
      );
    }
    throw err;
  }

  const rootPaths = [
    ...new Set(paths.map((p) => p.replace(/\\/g, '/').split('/')[0]).filter(Boolean)),
  ];
  const kind = kindHint ?? inferKindFromPaths(paths);
  let acContentSlugs = extractAcSlugs(paths, kind);
  if (acContentSlugs.length === 0 && (kind === 'car' || kind === 'track')) {
    const cleanedRoots = rootPaths.filter(
      (r) => r !== '__MACOSX' && !r.startsWith('.') && r !== 'desktop.ini',
    );
    if (cleanedRoots.length === 1) {
      acContentSlugs = [cleanedRoots[0]!];
    }
  }
  return {
    acContentSlugs,
    kind,
    rootPaths,
    contentTypeFolder: contentFolderForKind(kind),
  };
}

export function defaultAcSlugFromManifest(manifest: ModManifest, fallback: string): string {
  if (manifest.acContentSlugs.length === 1) {
    return manifest.acContentSlugs[0]!;
  }
  if (manifest.acContentSlugs.length > 1) {
    return manifest.acContentSlugs[0]!;
  }
  return fallback;
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Defaults when the admin only picks ZIP + car/track. */
export function metadataFromZipFilename(originalName: string): {
  displayName: string;
  versionLabel: string;
  packageSlug: string;
} {
  const base = path.basename(originalName, path.extname(originalName)).trim() || 'mod';
  const displayName = base
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return {
    displayName: displayName || 'Unnamed mod',
    versionLabel: '1.0',
    packageSlug: slugify(base),
  };
}

export function assertManifestMatchesKind(manifest: ModManifest, kind: ModKind): void {
  if (kind !== 'car' && kind !== 'track') {
    return;
  }
  if (manifest.acContentSlugs.length > 0) {
    return;
  }
  const folder = kind === 'car' ? 'cars/' : 'tracks/';
  throw new Error(
    `ZIP does not look like a ${kind}: no ${folder}<name>/ folder found. Repack or pick the correct type.`,
  );
}
