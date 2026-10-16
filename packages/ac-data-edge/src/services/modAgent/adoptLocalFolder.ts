import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import { edgeFolderStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import { hashContentTree } from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { modAgentAuthHeaders } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import { contentPoolPath, writeAcModSidecar } from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

function edgeId(): string {
  return (process.env.EDGE_ID || '').trim().toLowerCase();
}

function contentFolder(kind: ModKind): 'cars' | 'tracks' | 'weather' | null {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  if (kind === 'weather') return 'weather';
  return null;
}

function buildFolderManifest(kind: ModKind, slug: string): ModManifest {
  const folder = contentFolder(kind);
  if (!folder) {
    throw new Error('kind must be car|track|weather');
  }
  return {
    kind,
    acContentSlugs: [slug],
    rootPaths: [`${folder}/${slug}`],
    contentTypeFolder: folder,
  };
}

/**
 * Adopt an existing CONTENT_PATH folder into the hub catalog (no ZIP upload).
 * Writes .acmod.json sidecar and registers storage_origin=edge_folder.
 */
export async function handleAdoptLocalFolder(req: Request, res: Response): Promise<void> {
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

  const kindRaw = typeof req.body?.kind === 'string' ? req.body.kind.trim().toLowerCase() : '';
  const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : '';
  const displayName =
    typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim()
      : slug;

  if ((kindRaw !== 'car' && kindRaw !== 'track' && kindRaw !== 'weather') || !slug) {
    res.status(400).json({ ok: false, message: 'kind (car|track|weather) and slug required' });
    return;
  }
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    res.status(400).json({ ok: false, message: 'invalid slug' });
    return;
  }

  const kind = kindRaw as ModKind;
  const folder = contentFolder(kind)!;
  const destDir = path.join(contentPoolPath(), folder, slug);
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    res.status(404).json({ ok: false, message: `Folder not found: ${folder}/${slug}` });
    return;
  }

  try {
    const slimKind = kind === 'car' || kind === 'track' || kind === 'weather' ? kind : undefined;
    const { contentHash, sizeBytes, fileCount } = await hashContentTree(destDir, {
      slimKind,
    });
    if (fileCount === 0) {
      res.status(400).json({ ok: false, message: 'Folder is empty' });
      return;
    }
    const manifest = buildFolderManifest(kind, slug);
    const storageKey = edgeFolderStorageKey(id, kind as 'car' | 'track' | 'weather', slug, contentHash);

    const registerUrl = `${hubBase.replace(/\/+$/, '')}/api/mod-agent/v1/artifacts/register-local`;
    const registerRes = await fetch(registerUrl, {
      method: 'POST',
      headers: modAgentAuthHeaders(id),
      body: JSON.stringify({
        slug,
        displayName,
        kind,
        acContentSlug: slug,
        versionLabel: new Date().toISOString().slice(0, 10),
        sizeBytes,
        sha256: contentHash,
        storageKey,
        storageOrigin: 'edge_folder',
        manifest,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await registerRes.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      packageId?: string;
      artifactId?: string;
      hostCatalogSynced?: boolean;
      hostCatalogSyncError?: string;
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
      kind,
      slug,
      version: new Date().toISOString().slice(0, 10),
    });

    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mod-adopt] inventory rescan failed: ${message}`);
      });

    res.json({
      ok: true,
      message: `Adopted ${folder}/${slug} into catalog`,
      hostCatalogSynced: body.hostCatalogSynced === true,
      ...(body.hostCatalogSyncError
        ? { hostCatalogSyncError: body.hostCatalogSyncError }
        : {}),
      packageId: body.packageId,
      artifactId: body.artifactId,
      contentHash,
      sizeBytes,
      acContentSlug: slug,
      edgeId: id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mod-adopt] ${message}`);
    res.status(500).json({ ok: false, message });
  }
}

/** One-shot GC of permanent ZIP blobs under AC_MOD_ROOT/blobs (optional legacy). */
export async function handleGcModBlobs(_req: Request, res: Response): Promise<void> {
  const root = (process.env.AC_MOD_ROOT || '').trim();
  if (!root) {
    res.json({
      ok: true,
      deleted: 0,
      freedBytes: 0,
      message: 'AC_MOD_ROOT unset (no legacy blobs)',
    });
    return;
  }
  const blobsDir = path.join(root, 'blobs');
  if (!fs.existsSync(blobsDir)) {
    res.json({ ok: true, deleted: 0, freedBytes: 0, message: 'No blobs directory' });
    return;
  }

  async function rmTree(dir: string): Promise<{ deleted: number; freedBytes: number }> {
    let deleted = 0;
    let freedBytes = 0;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) {
          const nested = await rmTree(full);
          deleted += nested.deleted;
          freedBytes += nested.freedBytes;
          await fsp.rmdir(full).catch(() => undefined);
        } else if (ent.isFile()) {
          const st = await fsp.stat(full);
          await fsp.unlink(full);
          deleted += 1;
          freedBytes += st.size;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mod-gc-blobs] skip ${full}: ${message}`);
      }
    }
    return { deleted, freedBytes };
  }

  const { deleted, freedBytes } = await rmTree(blobsDir);
  res.json({
    ok: true,
    deleted,
    freedBytes,
    message: `Removed ${deleted} blob file(s), freed ~${Math.round(freedBytes / (1024 * 1024))} MiB`,
  });
}
