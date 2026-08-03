import { createWriteStream } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';
import type { SyncContentType } from './contentDistribution.js';

export interface CachedContentZip {
  zipPath: string;
  sizeBytes: number;
}

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = path.join(acDataRoot, '..', '..', '.content-zip-cache');

function cacheRoot(): string {
  return path.resolve(process.env.CLIENT_SYNC_ZIP_CACHE_PATH || DEFAULT_CACHE_DIR);
}

function cacheZipPath(type: SyncContentType, name: string, modifiedMs: number): string {
  return path.join(cacheRoot(), type, `${name}-${modifiedMs}.zip`);
}

function cachePartPath(type: SyncContentType, name: string, modifiedMs: number): string {
  return `${cacheZipPath(type, name, modifiedMs)}.part`;
}

async function ensureCacheDir(type: SyncContentType): Promise<void> {
  await fs.promises.mkdir(path.join(cacheRoot(), type), { recursive: true });
}

async function buildZipFile(
  modPath: string,
  archiveName: string,
  isDirectory: boolean,
  destPath: string,
): Promise<void> {
  const partPath = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(partPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    if (isDirectory) {
      archive.directory(modPath, archiveName);
    } else {
      archive.file(modPath, { name: path.basename(modPath) });
    }

    void archive.finalize();
  });

  await fs.promises.rename(partPath, destPath);
}

async function purgeStaleCacheVersions(
  type: SyncContentType,
  name: string,
  keepPath: string,
): Promise<void> {
  const typeDir = path.join(cacheRoot(), type);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(typeDir);
  } catch {
    return;
  }

  const prefix = `${name}-`;
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.zip'))
      .map(async (entry) => {
        const fullPath = path.join(typeDir, entry);
        if (fullPath === keepPath) return;
        await fs.promises.unlink(fullPath).catch(() => {});
        await fs.promises.unlink(`${fullPath}.part`).catch(() => {});
      }),
  );
}

export async function getCachedZipSizeIfExists(
  type: SyncContentType,
  name: string,
  modifiedMs: number,
): Promise<number | null> {
  const zipPath = cacheZipPath(type, name, modifiedMs);
  try {
    const stats = await fs.promises.stat(zipPath);
    if (!stats.isFile() || stats.size <= 0) return null;
    return stats.size;
  } catch {
    return null;
  }
}

export async function ensureContentZip(
  type: SyncContentType,
  name: string,
  modPath: string,
  modifiedMs: number,
): Promise<CachedContentZip> {
  await ensureCacheDir(type);

  const zipPath = cacheZipPath(type, name, modifiedMs);
  const partPath = cachePartPath(type, name, modifiedMs);

  try {
    const existing = await fs.promises.stat(zipPath);
    if (existing.isFile() && existing.size > 0) {
      return { zipPath, sizeBytes: existing.size };
    }
  } catch {
    /* cache miss */
  }

  try {
    await fs.promises.unlink(partPath);
  } catch {
    /* no stale part file */
  }

  const modStats = await fs.promises.stat(modPath);
  await buildZipFile(modPath, name, modStats.isDirectory(), zipPath);

  const built = await fs.promises.stat(zipPath);
  if (!built.isFile() || built.size <= 0) {
    throw new Error(`Failed to build content zip cache for ${name}`);
  }

  await purgeStaleCacheVersions(type, name, zipPath);

  return { zipPath, sizeBytes: built.size };
}

/** Test helper — reset default cache directory env between tests. */
export function resetContentZipCacheEnvForTests(): void {
  delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
}
