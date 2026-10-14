import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Sidecar written by adopt/upload — excluded from tree hash so re-adopt is stable. */
const SKIP_NAMES = new Set(['.acmod.json', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

export type ContentTreeHashResult = {
  contentHash: string;
  sizeBytes: number;
  fileCount: number;
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
 * Deterministic content hash of a CONTENT_PATH folder tree.
 * Uses sorted relative paths + size + per-file sha256 (portable across OS).
 */
export async function hashContentTree(rootDir: string): Promise<ContentTreeHashResult> {
  const abs = path.resolve(rootDir);
  const files: string[] = [];
  await walkFiles(abs, abs, files);
  files.sort((a, b) => {
    const ra = path.relative(abs, a).split(path.sep).join('/');
    const rb = path.relative(abs, b).split(path.sep).join('/');
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });

  const lines: string[] = [];
  let sizeBytes = 0;
  for (const filePath of files) {
    const rel = path.relative(abs, filePath).split(path.sep).join('/');
    const st = await fsp.stat(filePath);
    sizeBytes += st.size;
    const digest = await sha256File(filePath);
    lines.push(`${rel}\0${st.size}\0${digest}`);
  }

  return {
    contentHash: sha256Buffer(Buffer.from(lines.join('\n'), 'utf8')),
    sizeBytes,
    fileCount: files.length,
  };
}
