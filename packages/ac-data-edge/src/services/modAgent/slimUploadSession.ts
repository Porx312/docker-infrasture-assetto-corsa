/**
 * Smart slim upload: plan → put → commit.
 * Client sends only Pack/server-slim files; edge skips identical hashes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  contentHashFromFileEntries,
  hashContentTree,
  type ContentTreeFileEntry,
} from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import { edgeFolderStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import { mergeAllFiles } from '@projectd/ac-data-shared/mods/serverSlimCopy.js';
import {
  isServerSlimRelativePath,
  normalizeRelPath,
  type ServerSlimKind,
} from '@projectd/ac-data-shared/mods/serverSlimPaths.js';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { modAgentAuthHeaders } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import { contentPoolPath, writeAcModSidecar } from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

const SESSION_TTL_MS = Number(process.env.MOD_SLIM_UPLOAD_SESSION_TTL_MS || 30 * 60 * 1000);
const MAX_FILE_BYTES = Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024);

export type SlimUploadFileEntry = ContentTreeFileEntry;

type SlimSession = {
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

const sessions = new Map<string, SlimSession>();

function edgeId(): string {
  return (process.env.EDGE_ID || '').trim().toLowerCase();
}

function contentFolder(kind: ServerSlimKind): 'cars' | 'tracks' | 'weather' {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  return 'weather';
}

function stagingRoot(): string {
  return path.join(process.env.ADMIN_UPLOAD_DIR || os.tmpdir(), 'slim-upload');
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

/**
 * Compare client manifest against existing CONTENT_PATH slim tree + staging leftovers.
 * Exported for unit tests.
 */
export async function computeNeededAndSkip(
  destDir: string,
  kind: ServerSlimKind,
  files: SlimUploadFileEntry[],
  stagingDir?: string,
): Promise<{ needed: SlimUploadFileEntry[]; skip: SlimUploadFileEntry[] }> {
  const needed: SlimUploadFileEntry[] = [];
  const skip: SlimUploadFileEntry[] = [];
  for (const f of files) {
    const poolPath = path.join(destDir, ...f.rel.split('/'));
    const stagePath = stagingDir ? path.join(stagingDir, ...f.rel.split('/')) : null;
    let matched = false;
    for (const candidate of [stagePath, poolPath]) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      try {
        const st = await fsp.stat(candidate);
        if (st.size !== f.size) continue;
        const digest = await sha256File(candidate);
        if (digest === f.sha256) {
          matched = true;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (matched) skip.push(f);
    else needed.push(f);
  }
  return { needed, skip };
}

export async function handleSlimUploadPlan(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  const id = edgeId();
  if (!id) {
    res.status(503).json({ ok: false, message: 'EDGE_ID not configured' });
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

  const destDir = path.join(contentPoolPath(), contentFolder(kind), slug);
  if (fs.existsSync(destDir)) {
    try {
      const existing = await hashContentTree(destDir, { slimKind: kind });
      if (existing.contentHash === expectedContentHash) {
        res.json({
          ok: true,
          status: 'already_present',
          contentHash: existing.contentHash,
          fileCount: existing.fileCount,
          sizeBytes: existing.sizeBytes,
          needed: [],
          skip: files,
        });
        return;
      }
    } catch {
      /* fall through to plan upload */
    }
  }

  const sessionId = crypto.randomBytes(16).toString('hex');
  const stagingDir = path.join(stagingRoot(), sessionId);
  await fsp.mkdir(stagingDir, { recursive: true });

  const { needed, skip } = await computeNeededAndSkip(destDir, kind, files, stagingDir);

  const session: SlimSession = {
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
  };
  sessions.set(sessionId, session);

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

export async function handleSlimUploadPut(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  const sessionId = String(
    req.headers['x-slim-session-id'] || req.query.sessionId || '',
  ).trim();
  const rel = normalizeRelPath(
    String(req.headers['x-slim-rel'] || req.query.rel || ''),
  );
  const sha256 = String(req.headers['x-slim-sha256'] || req.query.sha256 || '')
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

export async function handleSlimUploadCommit(req: Request, res: Response): Promise<void> {
  purgeExpiredSessions();
  const id = edgeId();
  if (!id) {
    res.status(503).json({ ok: false, message: 'EDGE_ID not configured' });
    return;
  }
  const hubBase = getHubWorkerBaseUrl();
  if (!hubBase) {
    res.status(503).json({ ok: false, message: 'BACKEND_WORKER_URL required' });
    return;
  }

  const sessionId = String(req.body?.sessionId || '').trim();
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ ok: false, message: 'session not found or expired' });
    return;
  }

  try {
    // Ensure every needed file is staged (or still skippable from pool).
    const destDir = path.join(
      contentPoolPath(),
      contentFolder(session.kind),
      session.slug,
    );
    const { needed: stillNeeded } = await computeNeededAndSkip(
      destDir,
      session.kind,
      session.needed,
      session.stagingDir,
    );
    // Files still needed must exist in staging with correct hash.
    for (const f of stillNeeded) {
      const stagePath = path.join(session.stagingDir, ...f.rel.split('/'));
      if (!fs.existsSync(stagePath)) {
        res.status(400).json({
          ok: false,
          message: `missing staged file: ${f.rel}`,
        });
        return;
      }
      const digest = await sha256File(stagePath);
      if (digest !== f.sha256) {
        res.status(409).json({ ok: false, message: `staged hash mismatch: ${f.rel}` });
        return;
      }
    }

    // Build a complete slim tree in a temp merge dir: copy skip-from-pool + staging.
    const mergeTmp = path.join(session.stagingDir, '__merge_complete__');
    await fsp.rm(mergeTmp, { recursive: true, force: true });
    await fsp.mkdir(mergeTmp, { recursive: true });

    for (const f of session.files) {
      const outPath = path.join(mergeTmp, ...f.rel.split('/'));
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      const stagePath = path.join(session.stagingDir, ...f.rel.split('/'));
      const poolPath = path.join(destDir, ...f.rel.split('/'));
      if (fs.existsSync(stagePath)) {
        await fsp.copyFile(stagePath, outPath);
      } else if (fs.existsSync(poolPath)) {
        await fsp.copyFile(poolPath, outPath);
      } else {
        res.status(400).json({ ok: false, message: `missing source for ${f.rel}` });
        return;
      }
    }

    const verified = await hashContentTree(mergeTmp, { slimKind: session.kind });
    if (verified.contentHash !== session.expectedContentHash) {
      res.status(409).json({
        ok: false,
        message: 'integrity check failed: contentHash mismatch',
        got: verified.contentHash,
        expected: session.expectedContentHash,
      });
      return;
    }

    await fsp.mkdir(destDir, { recursive: true });
    await mergeAllFiles(mergeTmp, destDir);

    // Catalog identity is the client slim pack (mergeTmp), not the whole pool tree
    // (CONTENT_PATH may retain other skins/UI stubs from a full install).
    const contentHash = verified.contentHash;
    const sizeBytes = verified.sizeBytes;

    const storageKey = edgeFolderStorageKey(id, session.kind, session.slug, contentHash);
    const registerUrl = `${hubBase.replace(/\/+$/, '')}/api/mod-agent/v1/artifacts/register-local`;
    const registerRes = await fetch(registerUrl, {
      method: 'POST',
      headers: modAgentAuthHeaders(id),
      body: JSON.stringify({
        slug: session.slug,
        displayName: session.displayName,
        kind: session.kind,
        acContentSlug: session.slug,
        versionLabel: new Date().toISOString().slice(0, 10),
        sizeBytes,
        sha256: contentHash,
        storageKey,
        storageOrigin: 'edge_folder',
        manifest: {
          kind: session.kind,
          acContentSlugs: [session.slug],
          rootPaths: [`${contentFolder(session.kind)}/${session.slug}`],
          contentTypeFolder: contentFolder(session.kind),
          entryPaths: session.files.map((f) => f.rel).slice(0, 50_000),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await registerRes.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      packageId?: string;
      artifactId?: string;
    };
    if (!registerRes.ok || !body.ok) {
      res.status(registerRes.status || 502).json({
        ok: false,
        message: body.message || `Hub register failed HTTP ${registerRes.status}`,
      });
      return;
    }

    await writeAcModSidecar(destDir, {
      artifactId: body.artifactId,
      sha256: contentHash,
      contentHash,
      kind: session.kind,
      slug: session.slug,
      version: new Date().toISOString().slice(0, 10),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[slim-upload] sidecar write failed: ${message}`);
    });

    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[slim-upload] inventory rescan failed: ${message}`);
      });

    res.json({
      ok: true,
      message: 'Slim upload installed and registered',
      packageId: body.packageId,
      artifactId: body.artifactId,
      contentHash,
      sha256: contentHash,
      acContentSlug: session.slug,
      edgeId: id,
      uploadedFiles: session.needed.length,
      skippedFiles: session.skip.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[slim-upload] commit: ${message}`);
    res.status(500).json({ ok: false, message });
  } finally {
    sessions.delete(sessionId);
    void fsp.rm(session.stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Test helper: clear in-memory sessions. */
export function _resetSlimUploadSessionsForTests(): void {
  sessions.clear();
}
