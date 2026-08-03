import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import {
  deleteContent,
  getContentPath,
  listContent,
  type ContentType,
} from './contentManager.js';
import { isEmptyMod, modHasContentFiles } from './contentEmptyDetector.js';

export type SyncContentType = 'cars' | 'tracks';

export interface ContentManifestEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  fileCount: number;
  isEmpty: boolean;
  hasAcd: boolean;
  hasKn5: boolean;
  isDirectory: boolean;
}

function parseSyncType(type: string): SyncContentType | null {
  if (type === 'cars' || type === 'tracks') return type;
  return null;
}

async function analyzeMod(
  name: string,
  fullPath: string,
  isDirectory: boolean,
  size: number,
  modified: Date,
): Promise<ContentManifestEntry> {
  if (isDirectory) {
    const { hasAcd, hasKn5, fileCount } = await modHasContentFiles(fullPath);
    const empty = !hasAcd && !hasKn5;
    return {
      name,
      sizeBytes: size,
      modifiedAt: modified.toISOString(),
      fileCount,
      isEmpty: empty,
      hasAcd,
      hasKn5,
      isDirectory: true,
    };
  }

  const ext = path.extname(name).toLowerCase();
  const hasAcd = ext === '.acd';
  const hasKn5 = ext === '.kn5';
  return {
    name,
    sizeBytes: size,
    modifiedAt: modified.toISOString(),
    fileCount: 1,
    isEmpty: !hasAcd && !hasKn5,
    hasAcd,
    hasKn5,
    isDirectory: false,
  };
}

export async function buildContentManifest(type: SyncContentType): Promise<ContentManifestEntry[]> {
  const items = await listContent(type);
  const entries: ContentManifestEntry[] = [];
  for (const item of items) {
    entries.push(await analyzeMod(item.name, item.path, item.isDirectory, item.size, item.modified));
  }
  return entries;
}

export async function listEmptyContent(type: SyncContentType): Promise<ContentManifestEntry[]> {
  const manifest = await buildContentManifest(type);
  return manifest.filter((entry) => entry.isEmpty);
}

export async function deleteEmptyContent(
  type: SyncContentType,
  names?: string[],
  dryRun = false,
): Promise<{ ok: boolean; dryRun: boolean; deleted: string[]; skipped: string[] }> {
  const emptyEntries = await listEmptyContent(type);
  const emptyNames = new Set(emptyEntries.map((e) => e.name));
  const targets = names?.length ? names.filter((n) => emptyNames.has(n)) : [...emptyNames];
  const skipped = names?.length ? names.filter((n) => !emptyNames.has(n)) : [];

  if (dryRun) {
    return { ok: true, dryRun: true, deleted: targets, skipped };
  }

  const deleted: string[] = [];
  for (const name of targets) {
    const result = await deleteContent(type as ContentType, name);
    if (result.ok) deleted.push(name);
    else skipped.push(name);
  }

  return { ok: true, dryRun: false, deleted, skipped };
}

export function resolveModPath(type: SyncContentType, name: string): string | null {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return null;
  }
  const base = getContentPath(type);
  const target = path.join(base, name);
  const resolved = path.resolve(target);
  const prefix = `${path.resolve(base)}${path.sep}`;
  if (resolved !== path.resolve(base) && !resolved.startsWith(prefix)) {
    return null;
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return resolved;
}

export async function streamContentZip(type: SyncContentType, name: string, res: Response): Promise<void> {
  const modPath = resolveModPath(type, name);
  if (!modPath) {
    res.status(404).json({ ok: false, message: 'Mod not found' });
    return;
  }

  const stats = await fs.promises.stat(modPath);
  const zipName = `${name}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });

  archive.on('error', (err: Error) => {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, message: err.message });
      return;
    }
    res.end();
  });

  archive.pipe(res);

  if (stats.isDirectory()) {
    archive.directory(modPath, name);
  } else {
    archive.file(modPath, { name: path.basename(modPath) });
  }

  await archive.finalize();
}

export function parseSyncContentType(raw: string): SyncContentType | null {
  return parseSyncType(raw);
}
