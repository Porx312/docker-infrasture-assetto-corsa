/**
 * Hub library slim upload: plan → put → commit → Contabo S3 + catalog.
 * Never writes to any fleet VPS CONTENT_PATH.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Request, Response } from 'express';
import {
  contentHashFromFileEntries,
  hashContentTree,
  type ContentTreeFileEntry,
} from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import {
  artifactTarGzStorageKey,
  MOD_S3_FORMAT_TAR_GZ,
  readModS3Fields,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';
import {
  isServerSlimRelativePath,
  normalizeRelPath,
  type ServerSlimKind,
} from '@projectd/ac-data-shared/mods/serverSlimPaths.js';
import { getModPool } from './db.js';
import { headCanonicalObject, putCanonicalTarGz, storageMode } from './objectStorage.js';
import { registerS3LibraryArtifact } from './s3LibraryRegister.js';

const SESSION_TTL_MS = Number(process.env.MOD_SLIM_UPLOAD_SESSION_TTL_MS || 30 * 60 * 1000);
const MAX_FILE_BYTES = Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024);

type SlimUploadFileEntry = ContentTreeFileEntry;

type LibrarySession = {
  id: string;
  kind: ServerSlimKind;
  slug: string;
  displayName: string;
  expectedContentHash: string;
  files: SlimUploadFileEntry[];
  needed: SlimUploadFileEntry[];
  skip: SlimUploadFileEntry[];
  stagingDir: string;
  createdAt: number;
};

const sessions = new Map<string, LibrarySession>();

function contentFolder(kind: ServerSlimKind): 'cars' | 'tracks' | 'weather' {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  return 'weather';
}

function stagingRoot(): string {
  return path.join(process.env.ADMIN_UPLOAD_DIR || os.tmpdir(), 'hub-library-slim');
}

function purgeExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      void fsp.rm(s.stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
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

function validateManifest(
  kind: ServerSlimKind,
  files: SlimUploadFileEntry[],
): SlimUploadFileEntry[] {
  const out: SlimUploadFileEntry[] = [];
  const seen = new Set<string>();
  for (const raw of files) {
    const rel = normalizeRelPath(raw.rel);
    if (!rel || rel.includes('..') || !isServerSlimRelativePath(rel, kind)) {
      throw new Error(`Invalid or non-slim path: ${raw.rel}`);
    }
    if (seen.has(rel)) throw new Error(`Duplicate path: ${rel}`);
    seen.add(rel);
    const sha256 = String(raw.sha256 || '')
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid sha256 for ${rel}`);
    const size = Number(raw.size);
    if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) {
      throw new Error(`Invalid size for ${rel}`);
    }
    out.push({ rel, size, sha256 });
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

async function findLibraryByContentHash(contentHash: string): Promise<{
  packageId: string;
  artifactId: string;
} | null> {
  if (!process.env.DATABASE_URL) return null;
  const pool = getModPool();
  const r = await pool.query<{ id: string; package_id: string; manifest_json: unknown }>(
    `SELECT id, package_id, manifest_json FROM mod_artifacts WHERE sha256 = $1 ORDER BY created_at DESC LIMIT 5`,
    [contentHash.toLowerCase()],
  );
  for (const row of r.rows) {
    if (readModS3Fields(row.manifest_json)) {
      return { packageId: row.package_id, artifactId: row.id };
    }
  }
  return null;
}

async function computeNeededAndSkip(
  files: SlimUploadFileEntry[],
  stagingDir: string,
): Promise<{ needed: SlimUploadFileEntry[]; skip: SlimUploadFileEntry[] }> {
  const needed: SlimUploadFileEntry[] = [];
  const skip: SlimUploadFileEntry[] = [];
  for (const f of files) {
    const stagePath = path.join(stagingDir, ...f.rel.split('/'));
    if (fs.existsSync(stagePath)) {
      try {
        const st = await fsp.stat(stagePath);
        if (st.size === f.size) {
          const digest = await sha256File(stagePath);
          if (digest === f.sha256) {
            skip.push(f);
            continue;
          }
        }
      } catch {
        /* need upload */
      }
    }
    needed.push(f);
  }
  return { needed, skip };
}

async function packSlimTarGz(
  treeDir: string,
  slug: string,
  outGzPath: string,
): Promise<{ objectSha256: string; sizeBytes: number }> {
  const parent = path.dirname(treeDir);
  const folderName = path.basename(treeDir);
  if (folderName !== slug) {
    throw new Error(`tree dir basename must be slug (${slug}), got ${folderName}`);
  }
  const tarPath = `${outGzPath}.tmp.tar`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-cf', tarPath, '-C', parent, slug], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errBuf = '';
    child.stderr?.on('data', (c: Buffer) => {
      errBuf += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${code}): ${errBuf.slice(0, 400)}`));
    });
  });
  await pipeline(createReadStream(tarPath), createGzip(), createWriteStream(outGzPath));
  await fsp.unlink(tarPath).catch(() => undefined);
  const objectSha256 = await sha256File(outGzPath);
  const st = await fsp.stat(outGzPath);
  return { objectSha256, sizeBytes: st.size };
}

export async function handleLibrarySlimUploadPlan(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  if (storageMode() !== 's3') {
    res.status(503).json({ ok: false, message: 'MOD_STORAGE_MODE=s3 required for library upload' });
    return;
  }

  const kindRaw = String(req.body?.kind || '').trim().toLowerCase();
  if (kindRaw !== 'car' && kindRaw !== 'track' && kindRaw !== 'weather') {
    res.status(400).json({ ok: false, message: 'kind must be car|track|weather' });
    return;
  }
  const kind = kindRaw as ServerSlimKind;
  const slug = String(req.body?.slug || '').trim();
  if (!slug || slug.includes('..') || slug.includes('/')) {
    res.status(400).json({ ok: false, message: 'slug required' });
    return;
  }
  const expectedContentHash = String(req.body?.expectedContentHash || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedContentHash)) {
    res.status(400).json({ ok: false, message: 'expectedContentHash required' });
    return;
  }
  const displayName =
    typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim()
      : slug;

  let files: SlimUploadFileEntry[];
  try {
    if (!Array.isArray(req.body?.files)) throw new Error('files array required');
    files = validateManifest(kind, req.body.files as SlimUploadFileEntry[]);
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const recomputed = contentHashFromFileEntries(files);
  if (recomputed !== expectedContentHash) {
    res.status(400).json({
      ok: false,
      message: 'expectedContentHash does not match files manifest',
      expectedContentHash: recomputed,
    });
    return;
  }

  const existing = await findLibraryByContentHash(expectedContentHash);
  if (existing) {
    res.json({
      ok: true,
      status: 'already_present',
      contentHash: expectedContentHash,
      packageId: existing.packageId,
      artifactId: existing.artifactId,
      needed: [],
      skip: files,
    });
    return;
  }

  const sessionId = crypto.randomBytes(16).toString('hex');
  const stagingDir = path.join(stagingRoot(), sessionId);
  await fsp.mkdir(stagingDir, { recursive: true });
  const { needed, skip } = await computeNeededAndSkip(files, stagingDir);

  sessions.set(sessionId, {
    id: sessionId,
    kind,
    slug,
    displayName,
    expectedContentHash,
    files,
    needed,
    skip,
    stagingDir,
    createdAt: Date.now(),
  });

  res.json({
    ok: true,
    status: 'need_upload',
    sessionId,
    contentHash: expectedContentHash,
    needed: needed.map(({ rel, size, sha256 }) => ({ rel, size, sha256 })),
    skip: skip.map(({ rel, size, sha256 }) => ({ rel, size, sha256 })),
    neededBytes: needed.reduce((n, f) => n + f.size, 0),
    skipBytes: skip.reduce((n, f) => n + f.size, 0),
  });
}

export async function handleLibrarySlimUploadPut(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  const sessionId = String(req.headers['x-slim-session-id'] || '').trim();
  const rel = normalizeRelPath(String(req.headers['x-slim-rel'] || ''));
  const sha256 = String(req.headers['x-slim-sha256'] || '')
    .trim()
    .toLowerCase();

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ ok: false, message: 'session not found or expired' });
    return;
  }

  const expected = session.needed.find((f) => f.rel === rel);
  if (!expected) {
    res.status(400).json({ ok: false, message: `file not in needed list: ${rel}` });
    return;
  }
  if (sha256 !== expected.sha256) {
    res.status(409).json({ ok: false, message: 'sha256 header mismatch vs plan' });
    return;
  }

  const dest = path.join(session.stagingDir, ...rel.split('/'));
  await fsp.mkdir(path.dirname(dest), { recursive: true });

  const body = req.body;
  let buf: Buffer;
  if (Buffer.isBuffer(body)) {
    buf = body;
  } else if (body instanceof Uint8Array) {
    buf = Buffer.from(body);
  } else {
    res.status(400).json({ ok: false, message: 'raw body required' });
    return;
  }

  if (buf.byteLength !== expected.size) {
    res.status(409).json({
      ok: false,
      message: `size mismatch: got ${buf.byteLength}, expected ${expected.size}`,
    });
    return;
  }
  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  if (digest !== expected.sha256) {
    res.status(409).json({ ok: false, message: 'sha256 mismatch after upload' });
    return;
  }

  await fsp.writeFile(dest, buf);
  res.json({ ok: true, rel, sha256: digest, size: buf.byteLength });
}

export async function handleLibrarySlimUploadCommit(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  if (storageMode() !== 's3') {
    res.status(503).json({ ok: false, message: 'MOD_STORAGE_MODE=s3 required' });
    return;
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ ok: false, message: 'session not found or expired' });
    return;
  }

  try {
    for (const f of session.needed) {
      const stagePath = path.join(session.stagingDir, ...f.rel.split('/'));
      if (!fs.existsSync(stagePath)) {
        res.status(400).json({ ok: false, message: `missing staged file: ${f.rel}` });
        return;
      }
      const digest = await sha256File(stagePath);
      if (digest !== f.sha256) {
        res.status(409).json({ ok: false, message: `staged hash mismatch: ${f.rel}` });
        return;
      }
    }

    // Build complete slim tree under staging/{slug}/ for tar layout matching peer trees.
    const treeDir = path.join(session.stagingDir, '__tree__', session.slug);
    await fsp.rm(treeDir, { recursive: true, force: true });
    await fsp.mkdir(treeDir, { recursive: true });
    for (const f of session.files) {
      const outPath = path.join(treeDir, ...f.rel.split('/'));
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      const stagePath = path.join(session.stagingDir, ...f.rel.split('/'));
      if (!fs.existsSync(stagePath)) {
        res.status(400).json({ ok: false, message: `missing source for ${f.rel}` });
        return;
      }
      await fsp.copyFile(stagePath, outPath);
    }

    const verified = await hashContentTree(treeDir, { slimKind: session.kind });
    if (verified.contentHash !== session.expectedContentHash) {
      res.status(409).json({
        ok: false,
        message: 'integrity check failed: contentHash mismatch',
        got: verified.contentHash,
        expected: session.expectedContentHash,
      });
      return;
    }

    const gzPath = path.join(session.stagingDir, 'slim.tar.gz');
    const packed = await packSlimTarGz(treeDir, session.slug, gzPath);
    const key = artifactTarGzStorageKey(verified.contentHash);

    const put = await putCanonicalTarGz({
      key,
      filePath: gzPath,
      contentHash: verified.contentHash,
      objectSha256: packed.objectSha256,
      sizeBytes: packed.sizeBytes,
    });

    if (put.status === 'skipped_not_s3_mode') {
      res.status(503).json({ ok: false, message: 'S3 storage mode disabled' });
      return;
    }

    let finalSha = packed.objectSha256;
    let finalSize = packed.sizeBytes;
    if (put.status === 'already_exists') {
      const head = await headCanonicalObject(key);
      if (!head.exists) {
        res.status(502).json({ ok: false, message: 'S3 key exists but HEAD missing' });
        return;
      }
      const metaSha = head.metadata?.['object-sha256'] || head.metadata?.objectsha256;
      if (metaSha && /^[a-f0-9]{64}$/i.test(metaSha)) {
        finalSha = metaSha.toLowerCase();
      }
      if (typeof head.contentLength === 'number' && head.contentLength > 0) {
        finalSize = head.contentLength;
      }
    }

    const registered = await registerS3LibraryArtifact({
      slug: session.slug,
      displayName: session.displayName,
      kind: session.kind,
      acContentSlug: session.slug,
      versionLabel: new Date().toISOString().slice(0, 10),
      contentHash: verified.contentHash,
      sizeBytes: verified.sizeBytes,
      manifest: {
        kind: session.kind,
        acContentSlugs: [session.slug],
        rootPaths: [`${contentFolder(session.kind)}/${session.slug}`],
        contentTypeFolder: contentFolder(session.kind),
        entryPaths: session.files.map((f) => f.rel).slice(0, 50_000),
      },
      s3: {
        s3Key: key,
        s3Sha256: finalSha,
        s3SizeBytes: finalSize,
        s3Format: MOD_S3_FORMAT_TAR_GZ,
      },
    });

    console.log(
      `[library-slim] ok artifact=${registered.artifactId.slice(0, 8)}… key=${key} put=${put.status}`,
    );

    res.json({
      ok: true,
      message: 'Uploaded to Contabo library (S3)',
      packageId: registered.packageId,
      artifactId: registered.artifactId,
      contentHash: verified.contentHash,
      sha256: verified.contentHash,
      acContentSlug: session.slug,
      s3Key: key,
      uploadedFiles: session.needed.length,
      skippedFiles: session.skip.length,
      hostCatalogSynced: registered.hostCatalogSynced === true,
      ...(registered.hostCatalogSyncError
        ? { hostCatalogSyncError: registered.hostCatalogSyncError }
        : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[library-slim] commit: ${message}`);
    res.status(500).json({ ok: false, message });
  } finally {
    sessions.delete(sessionId);
    void fsp.rm(session.stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Test helper. */
export function _resetLibrarySlimSessionsForTests(): void {
  sessions.clear();
}
