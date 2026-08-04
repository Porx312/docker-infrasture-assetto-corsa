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

const inFlightBuilds = new Map<string, Promise<CachedContentZip>>();

function cacheRoot(): string {
  return path.resolve(process.env.CLIENT_SYNC_ZIP_CACHE_PATH || DEFAULT_CACHE_DIR);
}

function buildCacheKey(type: SyncContentType, name: string, modifiedMs: number): string {
  return `${type}/${name}/${modifiedMs}`;
}

function cacheZipPath(type: SyncContentType, name: string, modifiedMs: number): string {
  return path.join(cacheRoot(), type, `${name}-${modifiedMs}.zip`);
}

function cachePartPath(type: SyncContentType, name: string, modifiedMs: number): string {
  return `${cacheZipPath(type, name, modifiedMs)}.part`;
}

function zipCompressionLevel(type: SyncContentType): number {
  const fromEnv = process.env.CLIENT_SYNC_ZIP_LEVEL;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed)) {
      return Math.min(9, Math.max(0, Math.trunc(parsed)));
    }
  }
  // Large track folders compress slowly at level 6; level 1 is enough for launcher sync.
  return type === 'tracks' ? 1 : 6;
}

async function ensureCacheDir(type: SyncContentType): Promise<void> {
  await fs.promises.mkdir(path.join(cacheRoot(), type), { recursive: true });
}

async function buildZipFile(
  type: SyncContentType,
  modPath: string,
  archiveName: string,
  isDirectory: boolean,
  destPath: string,
): Promise<void> {
  const partPath = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(partPath);
    const archive = new ZipArchive({ zlib: { level: zipCompressionLevel(type) } });

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

async function buildContentZipInternal(
  type: SyncContentType,
  name: string,
  modPath: string,
  modifiedMs: number,
): Promise<CachedContentZip> {
  await ensureCacheDir(type);

  const zipPath = cacheZipPath(type, name, modifiedMs);
  const partPath = cachePartPath(type, name, modifiedMs);

  try {
    await fs.promises.unlink(partPath);
  } catch {
    /* no stale part file */
  }

  const modStats = await fs.promises.stat(modPath);
  await buildZipFile(type, modPath, name, modStats.isDirectory(), zipPath);

  const built = await fs.promises.stat(zipPath);
  if (!built.isFile() || built.size <= 0) {
    throw new Error(`Failed to build content zip cache for ${name}`);
  }

  await purgeStaleCacheVersions(type, name, zipPath);

  return { zipPath, sizeBytes: built.size };
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

export function isContentZipBuildInFlight(
  type: SyncContentType,
  name: string,
  modifiedMs: number,
): boolean {
  return inFlightBuilds.has(buildCacheKey(type, name, modifiedMs));
}

export async function ensureContentZip(
  type: SyncContentType,
  name: string,
  modPath: string,
  modifiedMs: number,
): Promise<CachedContentZip> {
  const zipPath = cacheZipPath(type, name, modifiedMs);

  try {
    const existing = await fs.promises.stat(zipPath);
    if (existing.isFile() && existing.size > 0) {
      return { zipPath, sizeBytes: existing.size };
    }
  } catch {
    /* cache miss */
  }

  const cacheKey = buildCacheKey(type, name, modifiedMs);
  const pending = inFlightBuilds.get(cacheKey);
  if (pending) {
    return pending;
  }

  const buildPromise = buildContentZipInternal(type, name, modPath, modifiedMs).finally(() => {
    inFlightBuilds.delete(cacheKey);
  });
  inFlightBuilds.set(cacheKey, buildPromise);
  return buildPromise;
}

/** Fire-and-forget zip build (shared single-flight with ensureContentZip). */
export function scheduleContentZipBuild(
  type: SyncContentType,
  name: string,
  modPath: string,
  modifiedMs: number,
): void {
  void ensureContentZip(type, name, modPath, modifiedMs).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[content-zip-cache] background build failed for ${type}/${name}: ${message}`);
  });
}

/** Test helper — reset default cache directory env and in-flight builds between tests. */
export function resetContentZipCacheEnvForTests(): void {
  delete process.env.CLIENT_SYNC_ZIP_CACHE_PATH;
  delete process.env.CLIENT_SYNC_ZIP_LEVEL;
  inFlightBuilds.clear();
}
