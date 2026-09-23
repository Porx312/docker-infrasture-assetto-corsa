import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { isModDbConfigured } from '../services/mods/db.js';
import {
  listPackagesWithLatestArtifact,
  listArtifactsForPackage,
  getDistributionMatrix,
  listFleetEdgesDb,
  setFleetEdgeEnabled,
} from '../services/mods/catalogRepo.js';
import { beginModUpload, finalizeModUpload, modStagingDir } from '../services/mods/uploadPipeline.js';
import {
  distributeArtifact,
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
  res.json({ ok: true, packages });
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

export async function modUploadFinalizeHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const uploadId = String(req.params.uploadId || '');
  try {
    const result = await finalizeModUpload({
      uploadId,
      displayName: String(req.body.displayName || ''),
      kind: req.body.kind,
      versionLabel: String(req.body.versionLabel || '1.0'),
      packageSlug: req.body.packageSlug,
      acContentSlug: req.body.acContentSlug,
      distributeTo: req.body.distributeTo ?? 'none',
    });
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function modUploadBeginHandler(req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ ok: false, message: 'file required' });
    return;
  }
  fs.mkdirSync(modStagingDir(), { recursive: true });
  const dest = path.join(modStagingDir(), path.basename(file.path));
  fs.renameSync(file.path, dest);
  const uploadId = await beginModUpload(file.originalname, dest);
  res.json({ ok: true, uploadId });
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
    res.status(400).json({ ok: false, message });
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

export async function listModEdgesHandler(_req: Request, res: Response): Promise<void> {
  if (!isModDbConfigured()) {
    modDbUnavailable(res);
    return;
  }
  await syncFleetEdgesToDb();
  const edges = await listFleetEdgesDb();
  res.json({ ok: true, edges });
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
