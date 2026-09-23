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

/** Inspect zip entries without full extract (for finalize). */
export async function buildManifestFromZip(zipPath: string, kindHint?: ModKind): Promise<ModManifest> {
  const paths: string[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', (entry: unzipper.Entry) => {
        paths.push(entry.path);
        entry.autodrain();
      })
      .on('close', () => resolve())
      .on('error', reject);
  });

  const rootPaths = [...new Set(paths.map((p) => p.replace(/\\/g, '/').split('/')[0]).filter(Boolean))];
  const kind = kindHint ?? inferKindFromPaths(paths);
  const acContentSlugs = extractAcSlugs(paths, kind);
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
