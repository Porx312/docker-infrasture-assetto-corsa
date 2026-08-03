import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import {
  getDownloadBlockedResponse,
  resolveContentDistribution,
  type ContentDistribution,
  type SyncContentType,
} from './contentDistribution.js';
import {
  deleteContent,
  getContentPath,
  listContent,
  type ContentType,
} from './contentManager.js';
import { modHasContentFiles } from './contentEmptyDetector.js';
import { ensureContentZip, getCachedZipSizeIfExists } from './contentZipCache.js';
import {
  sendZipDownloadFile,
  setZipDownloadNoCacheHeaders,
} from '../lib/sendZipDownload.js';

export type { SyncContentType } from './contentDistribution.js';

export interface ContentManifestEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  fileCount: number;
  isEmpty: boolean;
  hasAcd: boolean;
  hasKn5: boolean;
  isDirectory: boolean;
  distribution: ContentDistribution;
  downloadable: boolean;
  steamStoreUrl: string | null;
  displayName: string | null;
  zipSizeBytes: number | null;
}

/** Public launcher manifest — sync fields only (no operator heuristics). */
export interface LauncherContentEntry {
  name: string;
  modifiedAt: string;
  distribution: ContentDistribution;
  downloadable: boolean;
  steamStoreUrl: string | null;
  displayName: string | null;
  zipSizeBytes: number | null;
}

export interface LauncherBootstrapMeta {
  contentVersion: string | null;
  minHudVersion: string | null;
}

export function toLauncherContentEntry(entry: ContentManifestEntry): LauncherContentEntry {
  return {
    name: entry.name,
    modifiedAt: entry.modifiedAt,
    distribution: entry.distribution,
    downloadable: entry.downloadable,
    steamStoreUrl: entry.steamStoreUrl,
    displayName: entry.displayName,
    zipSizeBytes: entry.zipSizeBytes,
  };
}

export function computeContentVersion(
  ...groups: LauncherContentEntry[][]
): string | null {
  let maxMs = 0;
  let found = false;
  for (const items of groups) {
    for (const item of items) {
      const ms = Date.parse(item.modifiedAt);
      if (!Number.isNaN(ms) && ms > maxMs) {
        maxMs = ms;
        found = true;
      }
    }
  }
  return found ? new Date(maxMs).toISOString() : null;
}

export async function buildLauncherContentManifest(
  type: SyncContentType,
): Promise<LauncherContentEntry[]> {
  const manifest = await buildContentManifest(type);
  return manifest.map(toLauncherContentEntry);
}

function uniqueModNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/** Entry when INI references a mod that is not present on the VPS. */
export function missingLauncherContentEntry(
  type: SyncContentType,
  name: string,
): LauncherContentEntry {
  const dist = resolveContentDistribution(type, name);
  return {
    name,
    modifiedAt: new Date(0).toISOString(),
    distribution: dist.distribution,
    downloadable: false,
    steamStoreUrl: dist.steamStoreUrl,
    displayName: dist.displayName ?? name,
    zipSizeBytes: null,
  };
}

export async function buildLauncherContentEntryForName(
  type: SyncContentType,
  name: string,
): Promise<LauncherContentEntry> {
  const trimmed = name.trim();
  if (!trimmed) {
    return missingLauncherContentEntry(type, name);
  }

  const modPath = resolveModPath(type, trimmed);
  if (!modPath) {
    return missingLauncherContentEntry(type, trimmed);
  }

  const stats = await fs.promises.stat(modPath);
  const isDirectory = stats.isDirectory();
  const entry = await analyzeMod(
    type,
    trimmed,
    modPath,
    isDirectory,
    stats.size,
    stats.mtime,
  );
  return toLauncherContentEntry(entry);
}

/** Targeted lookup — only stats the requested mod ids (no full directory scan). */
export async function buildLauncherContentEntriesForNames(
  type: SyncContentType,
  names: string[],
): Promise<LauncherContentEntry[]> {
  const unique = uniqueModNames(names);
  const entries: LauncherContentEntry[] = [];
  for (const name of unique) {
    entries.push(await buildLauncherContentEntryForName(type, name));
  }
  return entries;
}

export async function buildRequiredContentForServer(
  cars: string[],
  track: string,
): Promise<{ cars: LauncherContentEntry[]; track: LauncherContentEntry | null }> {
  const [carEntries, trackEntry] = await Promise.all([
    buildLauncherContentEntriesForNames('cars', cars),
    track.trim()
      ? buildLauncherContentEntryForName('tracks', track.trim())
      : Promise.resolve(null),
  ]);
  return { cars: carEntries, track: trackEntry };
}

export type ContentDownloadReady = {
  ok: true;
  zipPath: string;
  sizeBytes: number;
  zipName: string;
};

export type ContentDownloadBlocked = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type ContentDownloadResult = ContentDownloadReady | ContentDownloadBlocked;

function parseSyncType(type: string): SyncContentType | null {
  if (type === 'cars' || type === 'tracks') return type;
  return null;
}

async function analyzeMod(
  type: SyncContentType,
  name: string,
  fullPath: string,
  isDirectory: boolean,
  size: number,
  modified: Date,
): Promise<ContentManifestEntry> {
  const dist = resolveContentDistribution(type, name);
  let zipSizeBytes: number | null = null;
  if (dist.downloadable && isDirectory) {
    const stat = await fs.promises.stat(fullPath);
    zipSizeBytes = await getCachedZipSizeIfExists(type, name, stat.mtimeMs);
  }

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
      distribution: dist.distribution,
      downloadable: dist.downloadable,
      steamStoreUrl: dist.steamStoreUrl,
      displayName: dist.displayName,
      zipSizeBytes,
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
    distribution: dist.distribution,
    downloadable: dist.downloadable,
    steamStoreUrl: dist.steamStoreUrl,
    displayName: dist.displayName,
    zipSizeBytes: null,
  };
}

export async function buildContentManifest(type: SyncContentType): Promise<ContentManifestEntry[]> {
  const items = await listContent(type);
  const entries: ContentManifestEntry[] = [];
  for (const item of items) {
    entries.push(
      await analyzeMod(type, item.name, item.path, item.isDirectory, item.size, item.modified),
    );
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

export async function prepareContentDownload(
  type: SyncContentType,
  name: string,
): Promise<ContentDownloadResult> {
  const dist = resolveContentDistribution(type, name);
  if (!dist.downloadable) {
    return { ok: false, status: 403, body: getDownloadBlockedResponse(type, name) };
  }

  const modPath = resolveModPath(type, name);
  if (!modPath) {
    return { ok: false, status: 404, body: { ok: false, message: 'Mod not found' } };
  }

  const stats = await fs.promises.stat(modPath);
  const cached = await ensureContentZip(type, name, modPath, stats.mtimeMs);

  return {
    ok: true,
    zipPath: cached.zipPath,
    sizeBytes: cached.sizeBytes,
    zipName: `${name}.zip`,
  };
}

function setContentZipHeaders(res: Response, zipName: string, sizeBytes: number): void {
  setZipDownloadNoCacheHeaders(res, zipName, sizeBytes);
}

export async function headContentZip(type: SyncContentType, name: string, res: Response): Promise<void> {
  const prepared = await prepareContentDownload(type, name);
  if (!prepared.ok) {
    res.status(prepared.status).json(prepared.body);
    return;
  }

  setContentZipHeaders(res, prepared.zipName, prepared.sizeBytes);
  res.end();
}

export async function streamContentZip(type: SyncContentType, name: string, res: Response): Promise<void> {
  const prepared = await prepareContentDownload(type, name);
  if (!prepared.ok) {
    res.status(prepared.status).json(prepared.body);
    return;
  }

  setContentZipHeaders(res, prepared.zipName, prepared.sizeBytes);
  await sendZipDownloadFile(res, prepared.zipPath);
}

export function parseSyncContentType(raw: string): SyncContentType | null {
  return parseSyncType(raw);
}
