import path from 'path';
import { deleteContent, listContent, type ContentType } from './contentManager.js';
import { modHasContentFiles } from './contentEmptyDetector.js';

export type SyncContentType = 'cars' | 'tracks';

export function parseSyncContentType(raw: string): SyncContentType | null {
  if (raw === 'cars' || raw === 'tracks') return raw;
  return null;
}

async function isEmptyMod(
  name: string,
  fullPath: string,
  isDirectory: boolean,
): Promise<boolean> {
  if (isDirectory) {
    const { hasAcd, hasKn5 } = await modHasContentFiles(fullPath);
    return !hasAcd && !hasKn5;
  }
  const ext = path.extname(name).toLowerCase();
  return ext !== '.acd' && ext !== '.kn5';
}

async function listEmptyModNames(type: SyncContentType): Promise<string[]> {
  const items = await listContent(type);
  const empty: string[] = [];
  for (const item of items) {
    if (await isEmptyMod(item.name, item.path, item.isDirectory)) {
      empty.push(item.name);
    }
  }
  return empty;
}

export async function deleteEmptyContent(
  type: SyncContentType,
  names?: string[],
  dryRun = false,
): Promise<{ ok: boolean; dryRun: boolean; deleted: string[]; skipped: string[] }> {
  const emptyNames = new Set(await listEmptyModNames(type));
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
