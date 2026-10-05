import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import unzipper from 'unzipper';
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import { edgeBlobStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { modAgentAuthHeaders } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import {
  ensureBlobCached,
  materializeManifestToPool,
  sha256File,
  getValidCachedBlob,
  contentPoolPath,
  writeAcModSidecar,
} from './materialize.js';
import { scanLocalModInventory, postModInventoryToHub } from '../modInventoryScan.js';

function inferKind(paths: string[]): ModKind {
  const normalized = paths.map((p) => p.replace(/\\/g, '/').toLowerCase());
  if (normalized.some((p) => /(^|\/)cars\//.test(p))) return 'car';
  if (normalized.some((p) => /(^|\/)tracks\//.test(p))) return 'track';
  if (normalized.some((p) => /(^|\/)weather\//.test(p))) return 'weather';
  // Bare car/track folder ZIPs (RaceDepartment etc.): look for AC markers.
  if (normalized.some((p) => /(^|\/)(data\.acd|data\/car\.ini|skins\/)/.test(p))) return 'car';
  if (normalized.some((p) => /(^|\/)(ui_track\.json|surfaces\.ini|map\.png|data\/surfaces\.ini)/.test(p))) {
    return 'track';
  }
  return 'misc';
}

function contentFolder(kind: ModKind): 'cars' | 'tracks' | 'weather' | undefined {
  if (kind === 'car') return 'cars';
  if (kind === 'track') return 'tracks';
  if (kind === 'weather') return 'weather';
  return undefined;
}

/** Slugs from cars/<slug>/… anywhere in the zip (root or nested wrapper). */
function extractSlugs(paths: string[], kind: ModKind): string[] {
  const folder = contentFolder(kind);
  if (!folder) return [];
  const slugs = new Set<string>();
  for (const raw of paths) {
    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
    const idx = parts.findIndex((seg) => seg.toLowerCase() === folder);
    if (idx >= 0) {
      const slug = parts[idx + 1];
      if (slug && !slug.includes('..') && slug !== '__MACOSX') slugs.add(slug);
    }
  }
  return [...slugs];
}

function singleRootSlug(paths: string[]): string | null {
  const roots = [
    ...new Set(
      paths
        .map((p) => p.replace(/\\/g, '/').split('/')[0])
        .filter((r): r is string => Boolean(r) && r !== '__MACOSX' && !r.startsWith('.') && r !== 'desktop.ini'),
    ),
  ];
  return roots.length === 1 ? roots[0]! : null;
}

async function buildManifestFromZip(zipPath: string, kindHint?: ModKind): Promise<ModManifest> {
  const paths: string[] = [];
  const archive = await unzipper.Open.file(zipPath);
  const entries = (archive as { files?: Array<{ path: string }> }).files ?? [];
  for (const entry of entries) {
    if (entry.path && !entry.path.endsWith('/')) {
      paths.push(entry.path.replace(/\\/g, '/'));
    }
  }
  const kind = kindHint && kindHint !== 'misc' ? kindHint : inferKind(paths);
  let slugs = extractSlugs(paths, kind);
  // Common layout: ZIP is just <car_folder>/… without a cars/ prefix.
  if (!slugs.length && (kind === 'car' || kind === 'track')) {
    const root = singleRootSlug(paths);
    if (root) slugs = [root];
  }
  const folder = contentFolder(kind);
  return {
    kind,
    acContentSlugs: slugs,
    rootPaths: folder ? slugs.map((s) => `${folder}/${s}`) : slugs,
    contentTypeFolder: folder,
    entryPaths: paths.slice(0, 50_000),
  };
}

function edgeId(): string {
  return (process.env.EDGE_ID || '').trim().toLowerCase();
}

/**
 * Local ZIP upload on this edge: cache blob, materialize pool, register metadata on hub (no hub ZIP).
 */
export async function handleLocalModUpload(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) {
    res.status(400).json({ ok: false, message: 'file required' });
    return;
  }
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

  const kindHintRaw = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';
  const kindHint =
    kindHintRaw === 'car' || kindHintRaw === 'track' || kindHintRaw === 'weather'
      ? (kindHintRaw as ModKind)
      : undefined;
  const displayName =
    typeof req.body?.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim()
      : path.basename(file.originalname || 'mod.zip', path.extname(file.originalname || '.zip'));

  try {
    const sha256 = await sha256File(file.path);
    const sizeBytes = fs.statSync(file.path).size;
    const manifest = await buildManifestFromZip(file.path, kindHint);
    if (!manifest.contentTypeFolder || !manifest.acContentSlugs.length) {
      res.status(400).json({
        ok: false,
        message:
          'ZIP must contain cars/<name>/ or tracks/<name>/ (or a single car/track folder at the ZIP root)',
      });
      return;
    }
    const acSlug = manifest.acContentSlugs[0]!;
    // Skip re-hash + prefer rename into blob store (big speedup for multi‑GB ZIPs).
    const cached = await ensureBlobCached(sha256, file.path, { trustedSource: true });
    await materializeManifestToPool(sha256, cached, manifest, acSlug, {
      sha256,
      kind: manifest.kind,
      slug: acSlug,
    });

    const registerUrl = `${hubBase.replace(/\/+$/, '')}/api/mod-agent/v1/artifacts/register-local`;
    const registerRes = await fetch(registerUrl, {
      method: 'POST',
      headers: modAgentAuthHeaders(id),
      body: JSON.stringify({
        slug: acSlug,
        displayName,
        kind: manifest.kind,
        acContentSlug: acSlug,
        versionLabel: new Date().toISOString().slice(0, 10),
        sizeBytes,
        sha256,
        storageKey: edgeBlobStorageKey(id, sha256),
        manifest,
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

    // Sidecar must include artifactId so inventory scan / UI can Sync & Remove.
    const destDir = path.join(contentPoolPath(), manifest.contentTypeFolder!, acSlug);
    await writeAcModSidecar(destDir, {
      artifactId: body.artifactId,
      sha256,
      kind: manifest.kind,
      slug: acSlug,
      version: new Date().toISOString().slice(0, 10),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mod-local-upload] sidecar write failed: ${message}`);
    });

    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mod-local-upload] inventory rescan failed: ${message}`);
      });

    res.json({
      ok: true,
      message: 'Installed on this VPS and registered (ZIP stays on this edge only)',
      packageId: body.packageId,
      artifactId: body.artifactId,
      sha256,
      acContentSlug: acSlug,
      edgeId: id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mod-local-upload] ${message}`);
    res.status(500).json({ ok: false, message });
  } finally {
    await fsp.unlink(file.path).catch(() => undefined);
  }
}

/** Stream content-addressed blob for peer copy (worker secret). */
export async function handleServeModBlob(req: Request, res: Response): Promise<void> {
  const sha256 = String(req.params.sha256 || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    res.status(400).json({ ok: false, error: 'invalid_sha256' });
    return;
  }
  const zipPath = await getValidCachedBlob(sha256);
  if (!zipPath) {
    res.status(404).json({ ok: false, error: 'blob_not_found' });
    return;
  }
  const stat = fs.statSync(zipPath);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('X-Content-Sha256', sha256);
  fs.createReadStream(zipPath).pipe(res);
}

/** Delete a car/track folder from this edge CONTENT_PATH pool (orphans without catalog OK). */
export async function handleDeleteLocalContent(req: Request, res: Response): Promise<void> {
  const kindRaw = String(req.params.kind || '').trim().toLowerCase();
  const slug = String(req.params.slug || '').trim();
  if ((kindRaw !== 'car' && kindRaw !== 'track') || !slug || slug.includes('..') || slug.includes('/')) {
    res.status(400).json({ ok: false, message: 'kind (car|track) and slug required' });
    return;
  }
  const folder = kindRaw === 'car' ? 'cars' : 'tracks';
  const destDir = path.join(contentPoolPath(), folder, slug);
  if (!fs.existsSync(destDir)) {
    res.status(404).json({ ok: false, message: 'content_not_found' });
    return;
  }
  try {
    await fsp.rm(destDir, { recursive: true, force: true });
    void scanLocalModInventory()
      .then((snap) => postModInventoryToHub(snap))
      .catch(() => undefined);
    res.json({ ok: true, message: `Removed ${folder}/${slug} from this VPS` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message });
  }
}
