import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import unzipper from 'unzipper';
import type { ModManifest } from '@projectd/ac-data-shared/mods/types.js';

const execFileAsync = promisify(execFile);

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

export async function ensureBlobCached(
  sha256: string,
  zipPath: string,
): Promise<string> {
  const dest = blobZipPath(sha256);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    await fsp.copyFile(zipPath, dest);
  }
  return dest;
}

export async function extractArtifactTree(sha256: string, zipPath: string): Promise<string> {
  const tree = extractDir(sha256);
  if (fs.existsSync(tree)) {
    return tree;
  }
  await fsp.mkdir(tree, { recursive: true });
  const archive = await unzipper.Open.file(zipPath);
  const entries = (archive as { files?: Array<{ path: string; stream: () => NodeJS.ReadableStream }> }).files ?? [];
  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/\\/g, '/');
    if (!normalizedPath || normalizedPath.includes('..')) {
      continue;
    }
    const targetPath = path.join(tree, normalizedPath);
    if (normalizedPath.endsWith('/')) {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(targetPath));
  }
  return tree;
}

async function hardlinkOrCopyDir(src: string, dest: string): Promise<void> {
  try {
    await execFileAsync('cp', ['-al', src, dest]);
  } catch {
    await fsp.cp(src, dest, { recursive: true });
  }
}

export async function materializeManifestToPool(
  sha256: string,
  zipPath: string,
  manifest: ModManifest,
  acContentSlug: string,
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
  await fsp.mkdir(path.join(pool, folder), { recursive: true });
  if (fs.existsSync(destDir)) {
    await fsp.rm(destDir, { recursive: true, force: true });
  }
  await hardlinkOrCopyDir(sourceDir, destDir);
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
