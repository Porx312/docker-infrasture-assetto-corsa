import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ModManifest } from '@projectd/ac-data-shared/mods/types.js';

export function contentPoolPath(): string {
  const raw = (process.env.CONTENT_PATH || '').trim();
  if (!raw) {
    throw new Error(
      'CONTENT_PATH is required (AC content tree with cars/ and tracks/).',
    );
  }
  return raw;
}

export type AcModSidecar = {
  artifactId?: string;
  sha256?: string;
  /** Folder-first tree hash (same value as sha256 for edge_folder artifacts). */
  contentHash?: string;
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
