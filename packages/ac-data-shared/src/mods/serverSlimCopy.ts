import fsp from 'node:fs/promises';
import path from 'node:path';
import { listContentTreeRelPaths } from './contentTreeHash.js';
import type { ServerSlimKind } from './serverSlimPaths.js';

/**
 * Copy only server-slim files from srcRoot into destRoot (mkdir as needed).
 * Does not delete other files already in destRoot (safe for full-game CONTENT_PATH).
 */
export async function mergeServerSlimFiles(
  srcRoot: string,
  destRoot: string,
  kind: ServerSlimKind,
): Promise<number> {
  const rels = await listContentTreeRelPaths(srcRoot, { slimKind: kind });
  await fsp.mkdir(destRoot, { recursive: true });
  for (const rel of rels) {
    const from = path.join(srcRoot, ...rel.split('/'));
    const to = path.join(destRoot, ...rel.split('/'));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
  return rels.length;
}

/** Merge every file from srcRoot into destRoot (used after slim tar extract). */
export async function mergeAllFiles(srcRoot: string, destRoot: string): Promise<number> {
  const rels = await listContentTreeRelPaths(srcRoot);
  await fsp.mkdir(destRoot, { recursive: true });
  for (const rel of rels) {
    const from = path.join(srcRoot, ...rel.split('/'));
    const to = path.join(destRoot, ...rel.split('/'));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
  return rels.length;
}
