import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import unzipper from 'unzipper';
import type { ModManifest } from '@projectd/ac-data-shared/mods/types.js';

const execFileAsync = promisify(execFile);

const MAX_ZIP_ENTRIES = Number(process.env.MOD_ZIP_MAX_ENTRIES || 50_000);
const MAX_ZIP_TOTAL_BYTES = Number(process.env.MOD_ZIP_MAX_TOTAL_BYTES || 8 * 1024 * 1024 * 1024);
const MAX_ZIP_FILE_BYTES = Number(process.env.MOD_ZIP_MAX_FILE_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_ZIP_DEPTH = Number(process.env.MOD_ZIP_MAX_DEPTH || 32);

function modRoot(): string {
  return process.env.AC_MOD_ROOT || '/var/lib/ac-mods';
}

export function contentPoolPath(): string {
  return process.env.CONTENT_PATH || path.join(modRoot(), 'pool');
}

function blobZipPath(sha256: string): string {
  const prefix = sha256.slice(0, 2);
  const mid = sha256.slice(2, 4);
  return path.join(modRoot(), 'blobs', 'sha256', prefix, mid, `${sha256}.zip`);
}

function extractDir(sha256: string): string {
  const prefix = sha256.slice(0, 2);
  const mid = sha256.slice(2, 4);
  return path.join(modRoot(), 'blobs', 'sha256', prefix, mid, sha256, 'tree');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Cache hit: content-addressed blob exists AND sha256 matches.
 * Invalid cache (exists but wrong hash) → delete and return null.
 */
export async function getValidCachedBlob(expectedSha256: string): Promise<string | null> {
  const dest = blobZipPath(expectedSha256);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    const digest = await sha256File(dest);
    if (digest !== expectedSha256) {
      console.warn(`[mod-agent] INVALID CACHE for ${expectedSha256.slice(0, 12)}… — redownload`);
      await fsp.unlink(dest).catch(() => undefined);
      return null;
    }
    return dest;
  } catch {
    await fsp.unlink(dest).catch(() => undefined);
    return null;
  }
}

export async function ensureBlobCached(sha256: string, zipPath: string): Promise<string> {
  const existing = await getValidCachedBlob(sha256);
  if (existing) {
    return existing;
  }
  const dest = blobZipPath(sha256);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const digest = await sha256File(zipPath);
  if (digest !== sha256) {
    throw new Error('SHA-256 mismatch before blob cache write');
  }
  await fsp.copyFile(zipPath, dest);
  return dest;
}

export type ZipPathValidation = { ok: true; relative: string } | { ok: false; reason: string };

/**
 * Validate ZIP entry path against Zip Slip / absolute / Windows drive / depth.
 * Uses path.normalize + resolve under destRoot — not a simple `includes('..')`.
 */
export function validateZipEntryPath(entryPath: string, destRoot: string): ZipPathValidation {
  if (!entryPath || !entryPath.trim()) {
    return { ok: false, reason: 'empty_path' };
  }
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { ok: false, reason: 'absolute_path' };
  }
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//') || normalized.startsWith('\\\\')) {
    return { ok: false, reason: 'windows_or_unc_path' };
  }
  const parts = normalized.split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.some((p) => p === '..')) {
    return { ok: false, reason: 'parent_segment' };
  }
  if (parts.length > MAX_ZIP_DEPTH) {
    return { ok: false, reason: 'excessive_depth' };
  }
  const resolvedRoot = path.resolve(destRoot);
  const targetPath = path.resolve(resolvedRoot, ...parts);
  const rel = path.relative(resolvedRoot, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'escapes_destination' };
  }
  return { ok: true, relative: parts.join(path.sep) };
}

type ZipEntryLike = {
  path: string;
  type?: string;
  uncompressedSize?: number;
  stream: () => NodeJS.ReadableStream;
  isSymbolicLink?: () => boolean;
};

export async function extractArtifactTree(sha256: string, zipPath: string): Promise<string> {
  const tree = extractDir(sha256);
  const staging = `${tree}.extracting`;
  if (fs.existsSync(tree)) {
    return tree;
  }
  await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  await fsp.mkdir(staging, { recursive: true });

  const archive = await unzipper.Open.file(zipPath);
  const entries = ((archive as { files?: ZipEntryLike[] }).files ?? []) as ZipEntryLike[];

  if (entries.length > MAX_ZIP_ENTRIES) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`ZIP entry count exceeds limit (${entries.length} > ${MAX_ZIP_ENTRIES})`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const entryType = String(entry.type || '').toLowerCase();
    if (entryType === 'symboliclink' || entryType === 'symlink' || entry.isSymbolicLink?.()) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`ZIP contains symlink: ${entry.path}`);
    }
    if (entryType === 'hardlink' || entryType === 'link') {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`ZIP contains hardlink: ${entry.path}`);
    }

    const validated = validateZipEntryPath(entry.path, staging);
    if (!validated.ok) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`ZIP path rejected (${validated.reason}): ${entry.path}`);
    }

    const size = Number(entry.uncompressedSize ?? 0);
    if (size > MAX_ZIP_FILE_BYTES) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`ZIP file too large: ${entry.path}`);
    }
    totalUncompressed += size;
    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error('ZIP total uncompressed size exceeds limit');
    }

    const targetPath = path.join(staging, validated.relative);
    if (entry.path.replace(/\\/g, '/').endsWith('/')) {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(targetPath));

    // Refuse if extractor created a symlink somehow
    const st = await fsp.lstat(targetPath);
    if (st.isSymbolicLink()) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Extracted symlink refused: ${entry.path}`);
    }
  }

  await fsp.rename(staging, tree);
  return tree;
}

async function hardlinkOrCopyDir(src: string, dest: string): Promise<void> {
  try {
    await execFileAsync('cp', ['-al', src, dest]);
  } catch {
    await fsp.cp(src, dest, { recursive: true });
  }
}

export type AcModSidecar = {
  artifactId?: string;
  sha256?: string;
  version?: string;
  kind?: string;
  slug?: string;
};

export async function writeAcModSidecar(
  destDir: string,
  meta: AcModSidecar,
): Promise<void> {
  const sidecarPath = path.join(destDir, '.acmod.json');
  await fsp.writeFile(sidecarPath, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readAcModSidecar(dir: string): Promise<AcModSidecar | null> {
  const sidecarPath = path.join(dir, '.acmod.json');
  try {
    const raw = await fsp.readFile(sidecarPath, 'utf8');
    const parsed = JSON.parse(raw) as AcModSidecar;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function materializeManifestToPool(
  sha256: string,
  zipPath: string,
  manifest: ModManifest,
  acContentSlug: string,
  meta?: AcModSidecar,
): Promise<void> {
  const tree = await extractArtifactTree(sha256, zipPath);
  const pool = contentPoolPath();
  const folder = manifest.contentTypeFolder;
  if (!folder) {
    throw new Error('Cannot materialize: unknown content folder in manifest');
  }

  const candidates = [
    path.join(tree, folder, acContentSlug),
    path.join(tree, acContentSlug),
    ...manifest.acContentSlugs.map((slug) => path.join(tree, folder, slug)),
  ];

  let sourceDir: string | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      sourceDir = candidate;
      break;
    }
  }
  if (!sourceDir) {
    throw new Error(`Extracted content not found for ${acContentSlug}`);
  }

  const destDir = path.join(pool, folder, acContentSlug);
  const stagingDest = `${destDir}.staging-${process.pid}`;
  await fsp.mkdir(path.join(pool, folder), { recursive: true });
  await fsp.rm(stagingDest, { recursive: true, force: true }).catch(() => undefined);
  await hardlinkOrCopyDir(sourceDir, stagingDest);
  if (meta) {
    await writeAcModSidecar(stagingDest, { ...meta, sha256, slug: acContentSlug });
  }
  // Atomic swap: rename staging over final (rm old then rename)
  const backup = `${destDir}.old-${process.pid}`;
  if (fs.existsSync(destDir)) {
    await fsp.rename(destDir, backup);
  }
  try {
    await fsp.rename(stagingDest, destDir);
  } catch (err) {
    if (fs.existsSync(backup)) {
      await fsp.rename(backup, destDir).catch(() => undefined);
    }
    throw err;
  }
  await fsp.rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

export async function removeFromPool(manifest: ModManifest, acContentSlug: string): Promise<void> {
  const pool = contentPoolPath();
  const folder = manifest.contentTypeFolder;
  if (!folder) {
    return;
  }
  const destDir = path.join(pool, folder, acContentSlug);
  if (fs.existsSync(destDir)) {
    await fsp.rm(destDir, { recursive: true, force: true });
  }
}

export async function verifyPoolSlug(
  manifest: ModManifest,
  acContentSlug: string,
): Promise<boolean> {
  const pool = contentPoolPath();
  const folder = manifest.contentTypeFolder;
  if (!folder) {
    return false;
  }
  const destDir = path.join(pool, folder, acContentSlug);
  return fs.existsSync(destDir);
}
