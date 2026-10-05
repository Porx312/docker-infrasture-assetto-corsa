import type { Request, Response } from 'express';
import fs from 'node:fs';
import { isModDbConfigured } from '../services/mods/db.js';
import {
  listPackagesWithLatestArtifact,
  listArtifactsForPackage,
  getDistributionMatrix,
  listFleetEdgesDb,
  setFleetEdgeEnabled,
  getPackageById,
  setPackagePreviewImageFilename,
  updatePackageMetadata,
  listFleetSyncIssues,
  estimateEdgeCapacity,
} from '../services/mods/catalogRepo.js';
import {
  distributeArtifact,
  forceDeleteModPackage,
  resyncArtifactOnEdges,
  verifyArtifactOnEdges,
  removePackageFromEdges,
  syncFleetEdgesToDb,
} from '../services/mods/orchestrator.js';
import { getArtifactById } from '../services/mods/catalogRepo.js';
import { streamLocalMasterArtifact } from '../services/mods/objectStorage.js';
import { listGcCandidates, runGcOnEdge } from '../services/mods/gcService.js';
import {
  getServerModReadiness,
  refreshServerModRequirements,
  syncMissingModsForServer,
} from '../services/mods/serverModRequirements.js';
import { readFleetEdgeIdFromRequest } from '../services/fleet/fleetAdminBridge.js';
import { ensureFleetEdgeRegistered } from '../services/mods/fleetEdgeDb.js';
import {
  deleteModPreviewImageFile,
  isModPreviewUploadConfigured,
  modPreviewPublicUrl,
  storeModPreviewImageFromTemp,
} from '../services/mods/modPreviewImages.js';
import {
  getModsCars,
  getModsTracks,
} from '../services/controlApi/modsInventory.js';
import {
  listFleetEdges,
  resolveFleetEdge,
  resolveFleetEdgeByInstanceId,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import fsp from 'node:fs/promises';
import { openAsBlob } from 'node:fs';

function modDbUnavailable(res: Response): void {
  res.status(503).json({ ok: false, message: 'Mod repository requires DATABASE_URL' });
}

export async function listModsHandler(_req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  await syncFleetEdgesToDb();
  const packages = await listPackagesWithLatestArtifact();
  res.json({
    ok: true,
    packages: packages.map((pkg) => ({
      ...pkg,
      imageUrl: pkg.preview_image_filename
        ? modPreviewPublicUrl(pkg.preview_image_filename)
        : null,
    })),
  });
}

export async function listModArtifactsHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const packageId = String(req.params.packageId || '');
  const artifacts = await listArtifactsForPackage(packageId);
  res.json({ ok: true, artifacts });
}

export async function modDistributeHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  const edgeIds = req.body.edgeIds === 'all' ? 'all' : (req.body.edgeIds as string[]);
  try {
    const result = await distributeArtifact(artifactId, edgeIds);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const blobMissing = message.startsWith('artifact_blob_missing');
    res.status(blobMissing ? 409 : 400).json({
      ok: false,
      error: blobMissing ? 'artifact_blob_missing' : undefined,
      message,
    });
  }
}

export async function modDistributionMatrixHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  const matrix = await getDistributionMatrix(artifactId);
  const art = await getArtifactById(artifactId);
  res.json({ ok: true, artifact: art, distribution: matrix });
}

export async function modResyncHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  const edgeIds = req.body.edgeIds as string[];
  const enqueued = await resyncArtifactOnEdges(artifactId, edgeIds);
  res.json({ ok: true, enqueued });
}

export async function modVerifyHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  const edgeIds = req.body.edgeIds as string[];
  const enqueued = await verifyArtifactOnEdges(artifactId, edgeIds);
  res.json({ ok: true, enqueued });
}

export async function modRemoveFromEdgesHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  const art = await getArtifactById(artifactId);
  if (!art) {
    res.status(404).json({ ok: false, message: 'Artifact not found' });
    return;
  }
  const edgeIds = req.body.edgeIds as string[];
  await removePackageFromEdges(art.package_id, edgeIds);
  res.json({ ok: true });
}

export async function modDeletePackageHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const packageId = String(req.params.packageId || '').trim();
  if (!packageId) {
    res.status(400).json({ ok: false, message: 'packageId required' });
    return;
  }
  try {
    const result = await forceDeleteModPackage(packageId);
    res.json({
      ok: true,
      ...result,
      message:
        'Deleted from hub catalog. VPS cache may remain until Remove from edges / GC.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'package_not_found') {
      res.status(404).json({ ok: false, error: 'package_not_found', message });
      return;
    }
    res.status(400).json({ ok: false, message });
  }
}

export async function listModEdgesHandler(_req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  await syncFleetEdgesToDb();
  const edges = await listFleetEdgesDb();
  res.json({
    ok: true,
    edges: edges.map((edge) => ({
      ...edge,
      processes: Array.isArray(edge.processes_json) ? edge.processes_json : [],
      capacity: estimateEdgeCapacity(edge),
    })),
  });
}

export async function listFleetSyncIssuesHandler(_req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  try {
    const issues = await listFleetSyncIssues();
    res.json({ ok: true, issues });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, message });
  }
}

export async function disableModEdgeHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const id = String(req.params.edgeId || '');
  await setFleetEdgeEnabled(id, req.body.enabled !== false);
  res.json({ ok: true });
}

export async function modGcListHandler(_req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const candidates = await listGcCandidates();
  res.json({ ok: true, candidates });
}

export async function modGcRunHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const edgeId = String(req.body.edgeId || '');
  const artifactIds = req.body.artifactIds as string[];
  const removed = await runGcOnEdge(edgeId, artifactIds);
  res.json({ ok: true, removed });
}

export async function modInternalDownloadHandler(req: Request, res: Response): Promise<void> {
  const key = String(req.query.key || '');
  const sha256 = String(req.query.sha256 || '');
  const token = String(req.query.token || '');
  if (!key || !sha256 || token !== sha256.slice(0, 16)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }
  await streamLocalMasterArtifact(key, res);
}

export async function serverModReadinessHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const serverName = String(req.params.name || '');
  const rawEdge = readFleetEdgeIdFromRequest(req) || String(req.query.edgeId || '');
  if (!rawEdge) {
    res.status(400).json({ ok: false, message: 'edgeId required (fleetEdge query or X-Fleet-Edge)' });
    return;
  }
  try {
    const edgeId = await ensureFleetEdgeRegistered(rawEdge);
    const readiness = await getServerModReadiness(serverName, edgeId);
    res.json({ ok: true, ...readiness });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function serverModRefreshHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const serverName = String(req.params.name || '');
  const rawEdge = readFleetEdgeIdFromRequest(req) || String(req.body.edgeId || '');
  const { track, cars, entries } = req.body as {
    track?: string;
    cars?: string;
    entries?: Array<{ model?: string }>;
  };
  if (!rawEdge) {
    res.status(400).json({ ok: false, message: 'edgeId required (fleetEdge query or body.edgeId)' });
    return;
  }
  try {
    const edgeId = await ensureFleetEdgeRegistered(rawEdge);
    await refreshServerModRequirements({ serverName, edgeId, track, cars, entries });
    const readiness = await getServerModReadiness(serverName, edgeId);
    res.json({ ok: true, ...readiness });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function serverModSyncMissingHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const serverName = String(req.params.name || '');
  const rawEdge = readFleetEdgeIdFromRequest(req) || String(req.body.edgeId || '');
  if (!rawEdge) {
    res.status(400).json({ ok: false, message: 'edgeId required' });
    return;
  }
  try {
    const edgeId = await ensureFleetEdgeRegistered(rawEdge);
    const enqueued = await syncMissingModsForServer(serverName, edgeId);
    res.json({ ok: true, enqueued });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

/** One cover image per package — replace semantics. */
export async function modPreviewImageUploadHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  if (!isModPreviewUploadConfigured()) {
    res.status(503).json({
      ok: false,
      message:
        'HUD_PUBLIC_BASE_URL (or PUBLIC_API_BASE_URL / MOD_HUB_PUBLIC_URL) required for mod preview uploads',
    });
    return;
  }
  const packageId = String(req.params.packageId || '').trim();
  if (!packageId) {
    res.status(400).json({ ok: false, message: 'packageId required' });
    return;
  }
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    res.status(404).json({ ok: false, message: 'package_not_found' });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ ok: false, message: 'file required' });
    return;
  }
  try {
    const stored = await storeModPreviewImageFromTemp(
      file.path,
      file.originalname || 'image.jpg',
      file.mimetype || 'image/jpeg',
      packageId,
    );
    if (pkg.preview_image_filename && pkg.preview_image_filename !== stored.filename) {
      await deleteModPreviewImageFile(pkg.preview_image_filename).catch(() => undefined);
    }
    await setPackagePreviewImageFilename(packageId, stored.filename);
    res.json({ ok: true, url: stored.url, filename: stored.filename, imageUrl: stored.url });
  } catch (err: unknown) {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function modPreviewImageDeleteHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const packageId = String(req.params.packageId || '').trim();
  if (!packageId) {
    res.status(400).json({ ok: false, message: 'packageId required' });
    return;
  }
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    res.status(404).json({ ok: false, message: 'package_not_found' });
    return;
  }
  try {
    if (pkg.preview_image_filename) {
      await deleteModPreviewImageFile(pkg.preview_image_filename).catch(() => undefined);
    }
    await setPackagePreviewImageFilename(packageId, null);
    res.json({ ok: true, imageUrl: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function modUpdatePackageHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const packageId = String(req.params.packageId || '').trim();
  if (!packageId) {
    res.status(400).json({ ok: false, message: 'packageId required' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  try {
    const updated = await updatePackageMetadata(packageId, {
      display_name: typeof body.display_name === 'string' ? body.display_name : undefined,
      ac_content_slug:
        typeof body.ac_content_slug === 'string' ? body.ac_content_slug : undefined,
      notes:
        body.notes === null
          ? null
          : typeof body.notes === 'string'
            ? body.notes
            : undefined,
      category:
        body.category === null
          ? null
          : typeof body.category === 'string'
            ? body.category
            : undefined,
    });
    if (!updated) {
      res.status(404).json({ ok: false, message: 'package_not_found' });
      return;
    }
    res.json({
      ok: true,
      package: {
        ...updated,
        imageUrl: updated.preview_image_filename
          ? modPreviewPublicUrl(updated.preview_image_filename)
          : null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function modEdgeInventoryHandler(req: Request, res: Response): Promise<void> {
  const edgeId = String(req.params.edgeId || '').trim().toLowerCase();
  if (!edgeId) {
    res.status(400).json({ ok: false, message: 'edgeId required' });
    return;
  }
  const edge = resolveFleetEdge(edgeId) ?? resolveFleetEdgeByInstanceId(edgeId);
  const instanceId = edge?.instanceId || edgeId;
  try {
    const [cars, tracks] = await Promise.all([getModsCars(instanceId), getModsTracks(instanceId)]);
    if (!cars || !tracks) {
      res.status(503).json({ ok: false, message: 'redis_unavailable' });
      return;
    }

    // Fill missing artifactId from hub catalog by ac_content_slug (orphans without .acmod.json).
    let carOut = cars.cars;
    let trackOut = tracks.tracks;
    if (isModDbConfigured()) {
      const packages = await listPackagesWithLatestArtifact();
      const byKey = new Map<
        string,
        { artifactId: string; packageId: string; displayName: string }
      >();
      for (const pkg of packages) {
        const art = pkg.latest_artifact as { id?: string } | null | undefined;
        if (!art?.id) continue;
        const slug = String(pkg.ac_content_slug || pkg.slug || '')
          .trim()
          .toLowerCase();
        if (!slug) continue;
        byKey.set(`${pkg.kind}:${slug}`, {
          artifactId: art.id,
          packageId: pkg.id,
          displayName: pkg.display_name,
        });
      }
      carOut = cars.cars.map((c) => {
        if (c.artifactId) return c;
        const hit = byKey.get(`car:${String(c.carModel || '').trim().toLowerCase()}`);
        return hit
          ? { ...c, artifactId: hit.artifactId, displayName: c.displayName || hit.displayName }
          : c;
      });
      trackOut = tracks.tracks.map((t) => {
        if (t.artifactId) return t;
        const hit = byKey.get(`track:${String(t.trackSlug || '').trim().toLowerCase()}`);
        return hit ? { ...t, artifactId: hit.artifactId } : t;
      });
    }

    res.json({
      ok: true,
      edgeId: edge?.id || edgeId,
      instanceId,
      label: edge?.label || edgeId,
      cars: carOut,
      tracks: trackOut,
      carsMeta: cars.meta,
      tracksMeta: tracks.meta,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, message });
  }
}

/** Delete car/track folder on a VPS (works without catalog artifact). */
export async function modEdgeDeleteContentHandler(req: Request, res: Response): Promise<void> {
  const edgeId = String(req.params.edgeId || '').trim().toLowerCase();
  const kind = String(req.params.kind || '').trim().toLowerCase();
  const slug = String(req.params.slug || '').trim();
  const edge = resolveFleetEdge(edgeId);
  if (!edge?.baseUrl) {
    res.status(404).json({ ok: false, message: `Unknown fleet edge: ${edgeId}` });
    return;
  }
  if ((kind !== 'car' && kind !== 'track') || !slug) {
    res.status(400).json({ ok: false, message: 'kind and slug required' });
    return;
  }
  const secret = (process.env.CONVEX_WORKER_SECRET || '').trim();
  if (!secret) {
    res.status(503).json({ ok: false, message: 'CONVEX_WORKER_SECRET missing' });
    return;
  }
  try {
    const url = new URL(
      `/admin/mods/local-content/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`,
      edge.baseUrl.endsWith('/') ? edge.baseUrl : `${edge.baseUrl}/`,
    );
    const upstream = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Worker-Secret': secret },
      signal: AbortSignal.timeout(Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 60_000)),
    });
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    res.status(upstream.status).json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, message });
  }
}

/** Proxy ZIP to edge local-upload (hub does not keep master ZIP). */
export async function modEdgeUploadHandler(req: Request, res: Response): Promise<void> {
  const edgeId = String(req.params.edgeId || '').trim().toLowerCase();
  const edge = resolveFleetEdge(edgeId);
  if (!edge?.baseUrl) {
    res.status(404).json({ ok: false, message: `Unknown fleet edge: ${edgeId}` });
    return;
  }
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) {
    res.status(400).json({ ok: false, message: 'file required' });
    return;
  }
  const secret = (process.env.CONVEX_WORKER_SECRET || '').trim();
  if (!secret) {
    res.status(503).json({ ok: false, message: 'CONVEX_WORKER_SECRET missing' });
    return;
  }
  try {
    // Stream file to edge (avoid loading multi‑GB ZIP into hub RAM).
    const blob = await openAsBlob(file.path);
    const form = new FormData();
    form.append('file', blob, file.originalname || 'mod.zip');
    const kind = typeof req.body?.kind === 'string' ? req.body.kind : '';
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : '';
    if (kind) form.append('kind', kind);
    if (displayName) form.append('displayName', displayName);

    const url = new URL(
      '/admin/mods/local-upload',
      edge.baseUrl.endsWith('/') ? edge.baseUrl : `${edge.baseUrl}/`,
    );
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'X-Worker-Secret': secret },
      body: form,
      signal: AbortSignal.timeout(Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 600_000)),
    });
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    res.status(upstream.status).json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, message });
  } finally {
    await fsp.unlink(file.path).catch(() => undefined);
  }
}
