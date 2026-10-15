import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  isServerSlimRelativePath,
  normalizeRelPath,
  type ServerSlimKind,
} from './serverSlimPaths.js';

/** Sidecar written by adopt/upload — excluded from tree hash so re-adopt is stable. */
const SKIP_NAMES = new Set(['.acmod.json', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

export type ContentTreeHashResult = {
  contentHash: string;
  sizeBytes: number;
  fileCount: number;
};

export type HashContentTreeOptions = {
  /**
   * When set, only Pack-equivalent (server-slim) files are hashed.
   * Used for adopt/sync identity so client assets do not change the hash.
   */
  slimKind?: ServerSlimKind;
};

async function walkFiles(rootDir: string, base: string, out: string[]): Promise<void> {
  const entries = await fsp.readdir(base, { withFileTypes: true });
  for (const ent of entries) {
    if (SKIP_NAMES.has(ent.name) || ent.name.startsWith('._')) continue;
    const full = path.join(base, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(rootDir, full, out);
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      out.push(full);
    }
  }
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * List relative file paths under root (forward slashes), optionally server-slim filtered.
 */
export async function listContentTreeRelPaths(
  rootDir: string,
  opts?: HashContentTreeOptions,
): Promise<string[]> {
  const abs = path.resolve(rootDir);
  const files: string[] = [];
  await walkFiles(abs, abs, files);
  let rels = files.map((f) => normalizeRelPath(path.relative(abs, f).split(path.sep).join('/')));
  if (opts?.slimKind) {
    rels = rels.filter((r) => isServerSlimRelativePath(r, opts.slimKind!));
  }
  rels.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return rels;
}

/**
 * Deterministic content hash of a CONTENT_PATH folder tree.
 * Uses sorted relative paths + size + per-file sha256 (portable across OS).
 * Pass `slimKind` for Content Manager Pack–style server identity.
 */
export async function hashContentTree(
  rootDir: string,
  opts?: HashContentTreeOptions,
): Promise<ContentTreeHashResult> {
  const abs = path.resolve(rootDir);
  const rels = await listContentTreeRelPaths(abs, opts);

  const lines: string[] = [];
  let sizeBytes = 0;
  for (const rel of rels) {
    const filePath = path.join(abs, ...rel.split('/'));
    const st = await fsp.stat(filePath);
    sizeBytes += st.size;
    const digest = await sha256File(filePath);
    lines.push(`${rel}\0${st.size}\0${digest}`);
  }

  return {
    contentHash: sha256Buffer(Buffer.from(lines.join('\n'), 'utf8')),
    sizeBytes,
    fileCount: rels.length,
  };
}
