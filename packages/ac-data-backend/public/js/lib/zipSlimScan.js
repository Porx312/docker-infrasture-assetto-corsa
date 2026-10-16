/**
 * Scan a car/track ZIP in the browser: filter server-slim files, hash, contentHash.
 */

import { unzipSync } from '../vendor/fflate.js';
import { isServerSlimRelativePath, normalizeRelPath } from './serverSlimPaths.js';
import { contentHashFromFileEntries, sha256Hex } from './contentTreeHash.js';

/**
 * @param {string[]} paths
 * @returns {'car' | 'track' | 'weather' | 'misc'}
 */
export function inferKindFromPaths(paths) {
  const normalized = paths.map((p) => p.replace(/\\/g, '/').toLowerCase());
  if (normalized.some((p) => /(^|\/)cars\//.test(p))) return 'car';
  if (normalized.some((p) => /(^|\/)tracks\//.test(p))) return 'track';
  if (normalized.some((p) => /(^|\/)weather\//.test(p))) return 'weather';
  if (normalized.some((p) => /(^|\/)(data\.acd|data\/car\.ini|skins\/)/.test(p))) return 'car';
  if (
    normalized.some((p) =>
      /(^|\/)(ui_track\.json|surfaces\.ini|map\.png|data\/surfaces\.ini)/.test(p),
    )
  ) {
    return 'track';
  }
  return 'misc';
}

/**
 * @param {'car' | 'track' | 'weather' | 'misc'} kind
 * @returns {'cars' | 'tracks' | 'weather' | undefined}
 */
function contentFolder(kind) {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  if (kind === 'weather') return 'weather';
  return undefined;
}

/**
 * @param {string[]} paths
 * @param {'car' | 'track' | 'weather' | 'misc'} kind
 * @returns {string[]}
 */
export function extractSlugs(paths, kind) {
  const folder = contentFolder(kind);
  if (!folder) return [];
  const slugs = new Set();
  for (const raw of paths) {
    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
    const idx = parts.findIndex((seg) => seg.toLowerCase() === folder);
    if (idx >= 0) {
      const slug = parts[idx + 1];
      if (slug && !slug.includes('..') && slug !== '__MACOSX') slugs.add(slug);
    }
  }
  return [...slugs];
}

/**
 * @param {string[]} paths
 * @returns {string | null}
 */
function singleRootSlug(paths) {
  const roots = [
    ...new Set(
      paths
        .map((p) => p.replace(/\\/g, '/').split('/')[0])
        .filter((r) => Boolean(r) && r !== '__MACOSX' && !r.startsWith('.') && r !== 'desktop.ini'),
    ),
  ];
  return roots.length === 1 ? roots[0] : null;
}

/**
 * Strip cars/<slug>/ or tracks/<slug>/ prefix (or single-root slug/) from a ZIP entry path.
 * @param {string} entryPath
 * @param {string} folder
 * @param {string} slug
 * @returns {string | null}
 */
export function relUnderSlug(entryPath, folder, slug) {
  const p = normalizeRelPath(entryPath);
  const lower = p.toLowerCase();
  const prefixA = `${folder}/${slug}/`.toLowerCase();
  if (lower.startsWith(prefixA)) return p.slice(prefixA.length);
  const prefixB = `${slug}/`.toLowerCase();
  if (lower.startsWith(prefixB) && !lower.startsWith(`${folder}/`)) {
    return p.slice(prefixB.length);
  }
  return null;
}

/**
 * @typedef {{
 *   kind: 'car' | 'track' | 'weather';
 *   slug: string;
 *   files: Array<{ rel: string; size: number; sha256: string; bytes: Uint8Array }>;
 *   expectedContentHash: string;
 *   rawBytes: number;
 *   slimBytes: number;
 * }} SlimZipScan
 */

/**
 * @param {File} file
 * @param {'car' | 'track' | 'weather'} [kindHint]
 * @returns {Promise<SlimZipScan>}
 */
export async function scanZipForSlimUpload(file, kindHint) {
  const ab = await file.arrayBuffer();
  const rawBytes = ab.byteLength;
  /** @type {Record<string, Uint8Array>} */
  let unzipped;
  try {
    // fflate filter receives { name, size, originalSize, compression } — not a string path.
    unzipped = unzipSync(new Uint8Array(ab), {
      filter: (file) => {
        const name = typeof file === 'string' ? file : String(file?.name || '');
        return Boolean(name) && !name.endsWith('/');
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ZIP: ${message}`);
  }

  const paths = Object.keys(unzipped)
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p && !p.endsWith('/'));
  const kind =
    kindHint && (kindHint === 'car' || kindHint === 'track' || kindHint === 'weather')
      ? kindHint
      : inferKindFromPaths(paths);
  if (kind === 'misc') {
    throw new Error('ZIP does not look like a car, track, or weather pack');
  }

  let slugs = extractSlugs(paths, kind);
  if (!slugs.length) {
    const root = singleRootSlug(paths);
    if (root) slugs = [root];
  }
  if (!slugs.length) {
    throw new Error(
      'ZIP must contain cars/<name>/ or tracks/<name>/ (or a single car/track folder at the ZIP root)',
    );
  }

  const slug = slugs[0];
  const folder = contentFolder(kind);
  if (!folder) throw new Error('unsupported kind');

  /** @type {Array<{ rel: string; size: number; sha256: string; bytes: Uint8Array }>} */
  const files = [];
  for (const entryPath of paths) {
    const bytes = unzipped[entryPath];
    if (!bytes) continue;
    const rel = relUnderSlug(entryPath, folder, slug);
    if (rel == null || !rel) continue;
    if (!isServerSlimRelativePath(rel, kind)) continue;
    const sha256 = await sha256Hex(bytes);
    files.push({ rel: normalizeRelPath(rel), size: bytes.byteLength, sha256, bytes });
  }

  if (!files.length) {
    throw new Error('No server-slim files found in ZIP (need data.acd / surfaces.ini / Pack files)');
  }

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const expectedContentHash = await contentHashFromFileEntries(files);
  const slimBytes = files.reduce((n, f) => n + f.size, 0);

  return {
    kind,
    slug,
    files,
    expectedContentHash,
    rawBytes,
    slimBytes,
  };
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
