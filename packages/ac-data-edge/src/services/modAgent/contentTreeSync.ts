import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import { edgeFolderStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  hashContentTree,
  listContentTreeRelPaths,
} from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import { mergeAllFiles } from '@projectd/ac-data-shared/mods/serverSlimCopy.js';
import type { ServerSlimKind } from '@projectd/ac-data-shared/mods/serverSlimPaths.js';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { modAgentAuthHeaders } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import { contentPoolPath, writeAcModSidecar } from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

function slimKindOf(kind: ModKind): ServerSlimKind | undefined {
  if (kind === 'car' || kind === 'track' || kind === 'weather') return kind;
  return undefined;
}

function contentFolder(kind: ModKind): 'cars' | 'tracks' | 'weather' | null {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  if (kind === 'weather') return 'weather';
  return null;
}

function parseKindSlug(kindRaw: string, slugRaw: string): { kind: ModKind; slug: string; folder: string } | null {
  const kind = kindRaw.trim().toLowerCase();
  const slug = slugRaw.trim();
  if ((kind !== 'car' && kind !== 'track' && kind !== 'weather') || !slug) return null;
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) return null;
  const folder = contentFolder(kind as ModKind);
  if (!folder) return null;
  return { kind: kind as ModKind, slug, folder };
}

/**
 * Stream a CONTENT_PATH folder as an uncompressed tar (peer pull).
 * Auth: worker secret (same as blob peer pull).
 */
export async function handleServeContentTree(req: Request, res: Response): Promise<void> {
  const parsed = parseKindSlug(String(req.params.kind || ''), String(req.params.slug || ''));
  if (!parsed) {
    res.status(400).json({ ok: false, error: 'invalid_kind_or_slug' });
    return;
  }
  const destDir = path.join(contentPoolPath(), parsed.folder, parsed.slug);
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    res.status(404).json({ ok: false, error: 'folder_not_found' });
    return;
  }

  const parent = path.join(contentPoolPath(), parsed.folder);
  const slimKind = slimKindOf(parsed.kind);
  const rels = await listContentTreeRelPaths(destDir, slimKind ? { slimKind } : undefined);
  if (!rels.length) {
    res.status(404).json({ ok: false, error: 'no_server_slim_files' });
    return;
  }

  const listPath = path.join(os.tmpdir(), `ac-slim-tar-${process.pid}-${Date.now()}.txt`);
  await fsp.writeFile(listPath, rels.map((r) => `${parsed.slug}/${r}`).join('\n') + '\n', 'utf8');

  res.setHeader('Content-Type', 'application/x-tar');
  res.setHeader('Content-Disposition', `attachment; filename="${parsed.slug}.tar"`);
  res.setHeader('X-Mod-Kind', parsed.kind);
  res.setHeader('X-Mod-Slug', parsed.slug);
  res.setHeader('X-Mod-Slim', slimKind ? '1' : '0');

  const child = spawn('tar', ['-cf', '-', '-C', parent, '-T', listPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    console.warn(`[mod-tree] tar stderr: ${chunk.toString('utf8').slice(0, 500)}`);
  });
  const cleanupList = () => {
    void fsp.unlink(listPath).catch(() => undefined);
  };
  child.on('error', (err) => {
    cleanupList();
    console.error(`[mod-tree] tar spawn failed: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'tar_failed' });
    } else {
      res.destroy(err);
    }
  });
  child.on('close', (code) => {
    cleanupList();
    if (code !== 0 && !res.writableEnded) {
      res.destroy(new Error(`tar exited ${code}`));
    }
  });
  child.stdout?.pipe(res);
}

/**
 * Install a peer tar stream into CONTENT_PATH (atomic rename), then adopt/register.
 * Body: raw tar. Query/body: kind, slug, artifactId?, contentHash?, versionLabel?
 */
export async function installContentTreeFromStream(
  kind: ModKind,
  slug: string,
  stream: NodeJS.ReadableStream,
  meta?: {
    artifactId?: string;
    contentHash?: string;
    versionLabel?: string;
    register?: boolean;
  },
): Promise<{ contentHash: string; sizeBytes: number; destDir: string }> {
  const folder = contentFolder(kind);
  if (!folder) throw new Error('invalid kind');
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new Error('invalid slug');
  }

  const pool = contentPoolPath();
  const parent = path.join(pool, folder);
  await fsp.mkdir(parent, { recursive: true });

  const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-mod-tree-'));
  const stagingParent = path.join(stagingRoot, folder);
  await fsp.mkdir(stagingParent, { recursive: true });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xf', '-', '-C', stagingParent], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let errBuf = '';
      child.stderr?.on('data', (c: Buffer) => {
        errBuf += c.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar extract failed (${code}): ${errBuf.slice(0, 400)}`));
      });
      stream.pipe(child.stdin!);
      stream.on('error', reject);
    });

    const extracted = path.join(stagingParent, slug);
    if (!fs.existsSync(extracted) || !fs.statSync(extracted).isDirectory()) {
      throw new Error(`Tar did not contain folder ${slug}`);
    }

    const slimKind = slimKindOf(kind);
    const { contentHash, sizeBytes } = await hashContentTree(extracted, {
      slimKind,
    });
    if (meta?.contentHash && meta.contentHash.toLowerCase() !== contentHash) {
      throw new Error(
        `contentHash mismatch: expected ${meta.contentHash.slice(0, 12)}… got ${contentHash.slice(0, 12)}…`,
      );
    }

    // Merge into pool (do not replace whole folder — preserves client assets on shared install).
    const finalDir = path.join(parent, slug);
    await mergeAllFiles(extracted, finalDir);

    await writeAcModSidecar(finalDir, {
      artifactId: meta?.artifactId,
      sha256: contentHash,
      contentHash,
      kind,
      slug,
      ...(meta?.versionLabel ? { version: meta.versionLabel } : {}),
    });

    if (meta?.register !== false) {
      const id = (process.env.EDGE_ID || '').trim().toLowerCase();
      const hubBase = getHubWorkerBaseUrl();
      if (id && hubBase && meta?.artifactId) {
        // Inventory report is enough when job complete updates READY; optional re-register skipped.
      } else if (id && hubBase && !meta?.artifactId) {
        const storageKey = edgeFolderStorageKey(id, kind as 'car' | 'track' | 'weather', slug, contentHash);
        const manifest: ModManifest = {
          kind,
          acContentSlugs: [slug],
          rootPaths: [`${folder}/${slug}`],
          contentTypeFolder: folder,
        };
        const registerUrl = `${hubBase.replace(/\/+$/, '')}/api/mod-agent/v1/artifacts/register-local`;
        await fetch(registerUrl, {
          method: 'POST',
          headers: modAgentAuthHeaders(id),
          body: JSON.stringify({
            slug,
            displayName: slug,
            kind,
            acContentSlug: slug,
            versionLabel: meta?.versionLabel || new Date().toISOString().slice(0, 10),
            sizeBytes,
            sha256: contentHash,
            storageKey,
            storageOrigin: 'edge_folder',
            manifest,
          }),
          signal: AbortSignal.timeout(120_000),
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[mod-tree] register after install failed: ${message}`);
        });
      }
    }

    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch(() => undefined);

    return { contentHash, sizeBytes, destDir: finalDir };
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** HTTP: POST /api/mod-agent/v1/trees/install?kind=&slug= with tar body (or multipart unused). */
export async function handleInstallContentTree(req: Request, res: Response): Promise<void> {
  const kindRaw = String(req.query.kind || req.body?.kind || '').trim();
  const slug = String(req.query.slug || req.body?.slug || '').trim();
  const parsed = parseKindSlug(kindRaw, slug);
  if (!parsed) {
    res.status(400).json({ ok: false, message: 'kind and slug required' });
    return;
  }
  const artifactId =
    typeof req.query.artifactId === 'string'
      ? req.query.artifactId
      : typeof req.body?.artifactId === 'string'
        ? req.body.artifactId
        : undefined;
  const contentHash =
    typeof req.query.contentHash === 'string'
      ? req.query.contentHash
      : typeof req.headers['x-content-hash'] === 'string'
        ? req.headers['x-content-hash']
        : undefined;

  try {
    const result = await installContentTreeFromStream(parsed.kind, parsed.slug, req, {
      artifactId,
      contentHash,
      register: !artifactId,
    });
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mod-tree-install] ${message}`);
    res.status(500).json({ ok: false, message });
  }
}

/**
 * Peer-pull install for mod agent: download tar from treeDownloadUrl into pool.
 */
export async function pullAndInstallContentTree(
  treeUrl: string,
  kind: ModKind,
  slug: string,
  headers: Record<string, string> | undefined,
  meta: { artifactId?: string; contentHash?: string; versionLabel?: string },
  onProgress?: (pct: number) => void,
): Promise<{ contentHash: string; sizeBytes: number }> {
  const res = await fetch(treeUrl, {
    headers,
    signal: AbortSignal.timeout(Number(process.env.MOD_TREE_PULL_TIMEOUT_MS || 600_000)),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Tree download failed HTTP ${res.status}`);
  }
  onProgress?.(10);
  // Node fetch body is a web ReadableStream — convert for tar stdin
  const nodeStream = res.body as unknown as NodeJS.ReadableStream;
  const { Readable } = await import('node:stream');
  const readable =
    typeof (nodeStream as { pipe?: unknown }).pipe === 'function'
      ? (nodeStream as NodeJS.ReadableStream)
      : Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);

  onProgress?.(40);
  const result = await installContentTreeFromStream(kind, slug, readable, {
    ...meta,
    register: false,
  });
  onProgress?.(100);
  return result;
}

/**
 * Canonical S3 pull: download tar.gz (hash of object bytes) → gunzip → install tree
 * (contentHash of slim tree must match meta.contentHash). Partial files never published.
 */
export async function pullAndInstallS3TarGz(
  s3Url: string,
  kind: ModKind,
  slug: string,
  objectSha256: string,
  objectSizeBytes: number,
  meta: { artifactId?: string; contentHash?: string; versionLabel?: string },
  onProgress?: (pct: number) => void,
): Promise<{ contentHash: string; sizeBytes: number }> {
  const { downloadWithResume } = await import('./downloadArtifact.js');
  const { createGunzip } = await import('node:zlib');
  const { createReadStream } = await import('node:fs');

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ac-s3-pull-'));
  const gzPath = path.join(tmpDir, `${objectSha256}.tar.gz`);
  try {
    onProgress?.(5);
    const { downloadMs, hashMs } = await downloadWithResume(
      s3Url,
      gzPath,
      objectSizeBytes,
      (pct) => onProgress?.(Math.min(70, Math.round(pct * 0.7))),
      objectSha256.toLowerCase(),
    );
    onProgress?.(75);
    const tExtract = Date.now();
    const gunzip = createGunzip();
    const tarStream = createReadStream(gzPath).pipe(gunzip);
    const result = await installContentTreeFromStream(kind, slug, tarStream, {
      ...meta,
      register: false,
    });
    const extractMs = Date.now() - tExtract;
    console.log(
      `[mod-s3-pull] slug=${slug} size=${objectSizeBytes} downloadMs=${downloadMs} hashMs=${hashMs} extractMs=${extractMs}`,
    );
    onProgress?.(100);
    return result;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
