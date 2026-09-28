import type { Request, Response } from 'express';
import { readEdgeIdFromRequest, isModAgentRequestAuthorized } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import { isModDbConfigured } from '../services/mods/db.js';
import {
  acquireJobForEdge,
  reportJobProgress,
  completeJob,
  failJob,
  getDesiredStateForEdge,
  getDownloadUrlForArtifact,
  applyInventoryReport,
} from '../services/mods/orchestrator.js';
import { recordEdgeHeartbeat } from '../services/mods/catalogRepo.js';
import type { InventoryReportItem } from '@projectd/ac-data-shared/mods/types.js';
import {
  refreshServerModRequirements,
  getServerModReadiness,
} from '../services/mods/serverModRequirements.js';

function unauthorized(res: Response): void {
  res.status(401).json({ ok: false, error: 'unauthorized' });
}

export async function modAgentHeartbeatHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const diskFreeBytes =
    typeof req.body.diskFreeBytes === 'number' ? req.body.diskFreeBytes : undefined;
  await recordEdgeHeartbeat(edgeId, diskFreeBytes);
  res.json({ ok: true, edgeId });
}

export async function modAgentDesiredStateHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const desired = await getDesiredStateForEdge(edgeId);
  res.json({ ok: true, edgeId, desired });
}

export async function modAgentAcquireJobHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const agentId = String(req.body.agentId || edgeId);
  const job = await acquireJobForEdge(edgeId, agentId);
  if (!job) {
    res.status(204).send();
    return;
  }
  res.json({ ok: true, job });
}

export async function modAgentDownloadUrlHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const artifactId = String(req.params.artifactId || '');
  try {
    const signed = await getDownloadUrlForArtifact(artifactId);
    res.json({ ok: true, ...signed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const blobMissing = message.startsWith('artifact_blob_missing');
    res.status(blobMissing ? 409 : 404).json({
      ok: false,
      error: blobMissing ? 'artifact_blob_missing' : 'not_found',
      message,
    });
  }
}

export async function modAgentJobProgressHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const jobId = String(req.params.jobId || '');
  const progressPct = Number(req.body.progressPct ?? 0);
  const phase = String(req.body.phase || 'download');
  await reportJobProgress(jobId, edgeId, progressPct, phase);
  res.json({ ok: true });
}

export async function modAgentJobCompleteHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const jobId = String(req.params.jobId || '');
  const installedSha256 = String(req.body.installedSha256 || '');
  await completeJob(jobId, edgeId, installedSha256);
  res.json({ ok: true });
}

export async function modAgentJobFailHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const jobId = String(req.params.jobId || '');
  const errorCode = String(req.body.errorCode || 'unknown');
  const errorMessage = String(req.body.errorMessage || 'Job failed');
  const retriable = req.body.retriable !== false;
  await failJob(jobId, edgeId, errorCode, errorMessage, retriable);
  res.json({ ok: true });
}

export async function modAgentServerModsRefreshHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const serverName = String(req.params.name || '');
  const { track, cars, entries } = req.body as {
    track?: string;
    cars?: string;
    entries?: Array<{ model?: string }>;
  };
  try {
    await refreshServerModRequirements({ serverName, edgeId, track, cars, entries });
    const readiness = await getServerModReadiness(serverName, edgeId);
    res.json({ ok: true, ...readiness });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, message });
  }
}

export async function modAgentInventoryReportHandler(req: Request, res: Response): Promise<void> {
  if (!isModAgentRequestAuthorized(req) || !isModDbConfigured()) {
    unauthorized(res);
    return;
  }
  const edgeId = readEdgeIdFromRequest(req);
  const items = (req.body.items || []) as InventoryReportItem[];
  await applyInventoryReport(edgeId, items);
  res.json({ ok: true });
}
