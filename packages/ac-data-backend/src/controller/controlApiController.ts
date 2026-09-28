import type { Request, Response } from 'express';
import { isWorkerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import {
  getAgentPresence,
  storeAgentPresence,
  type AgentServerSlot,
} from '../services/controlApi/agentPresence.js';
import { applyDesiredConfig, type DesiredConfigBody } from '../services/controlApi/desiredConfig.js';
import { getLiveSummary, getServerLiveRoster } from '../services/controlApi/liveRoster.js';
import {
  getModsCars,
  getModsTracks,
  storeModsInventory,
  type ModsInventorySnapshot,
} from '../services/controlApi/modsInventory.js';
import {
  applySlotConfig,
  runSlotLifecycle,
  type SlotLifecycleAction,
} from '../services/controlApi/serverLifecycle.js';
import {
  allocateServerSlot,
  getServerSlotById,
  isServerSlotsDbConfigured,
  listServerSlots,
  syncSlotsFromAgentPresence,
  upsertServerSlot,
  type ServerSlotStatus,
} from '../services/controlApi/serverSlots.js';
import type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';

function requireServerSlotsDb(res: Response): boolean {
  if (!isServerSlotsDbConfigured()) {
    res.status(503).json({ ok: false, error: 'database_unavailable' });
    return false;
  }
  return true;
}

function slotToJson(slot: Awaited<ReturnType<typeof getServerSlotById>>) {
  if (!slot) {
    return null;
  }
  return {
    id: slot.id,
    instanceId: slot.instanceId,
    region: slot.region,
    lobbyName: slot.lobbyName,
    folderSlug: slot.folderSlug,
    status: slot.status,
    appliedConfig: slot.appliedConfig,
    presetRef: slot.presetRef,
    playerCount: slot.playerCount,
    lastHeartbeatAt: slot.lastHeartbeatAt,
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
}

function requireWorker(req: Request, res: Response): boolean {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function parseAgentServers(raw: unknown): AgentServerSlot[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw as AgentServerSlot[];
}

export async function postAgentRegisterHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const servers = parseAgentServers(body.servers);
    const region = typeof body.region === 'string' ? body.region : undefined;
    const { expiresInSec, doc } = await storeAgentPresence({
      instanceId,
      region,
      agentVersion: typeof body.agentVersion === 'string' ? body.agentVersion : undefined,
      servers,
      isHeartbeat: false,
    });
    if (isServerSlotsDbConfigured()) {
      void syncSlotsFromAgentPresence({
        instanceId: doc.instanceId,
        region: doc.region,
        servers: doc.servers,
      }).catch((err: unknown) => {
        console.warn(
          '[control-api] syncSlotsFromAgentPresence failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }
    res.json({ ok: true, instanceId, expiresInSec });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'redis_unavailable' ? 503 : 400;
    res.status(status).json({ ok: false, error: message });
  }
}

export async function postAgentHeartbeatHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const servers = parseAgentServers(body.servers);
    const region = typeof body.region === 'string' ? body.region : undefined;
    const { expiresInSec, doc } = await storeAgentPresence({
      instanceId,
      region,
      agentVersion: typeof body.agentVersion === 'string' ? body.agentVersion : undefined,
      servers,
      isHeartbeat: true,
    });
    if (isServerSlotsDbConfigured()) {
      void syncSlotsFromAgentPresence({
        instanceId: doc.instanceId,
        region: doc.region,
        servers: doc.servers,
      }).catch((err: unknown) => {
        console.warn(
          '[control-api] syncSlotsFromAgentPresence failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }
    res.json({ ok: true, instanceId, expiresInSec });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'redis_unavailable' ? 503 : 400;
    res.status(status).json({ ok: false, error: message });
  }
}

export async function getAgentPresenceHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const instanceId = typeof req.params.instanceId === 'string' ? req.params.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const presence = await getAgentPresence(instanceId);
    if (!presence) {
      res.status(404).json({ ok: false, error: 'not_found', instanceId });
      return;
    }
    res.json({ ok: true, instanceId, presence });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getServerLiveHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const serverId = typeof req.params.serverId === 'string' ? req.params.serverId : '';
  if (!serverId.trim()) {
    res.status(400).json({ ok: false, error: 'serverId_required' });
    return;
  }
  const instanceIdRaw = req.query.instanceId;
  const instanceId =
    typeof instanceIdRaw === 'string' && instanceIdRaw.trim()
      ? instanceIdRaw.trim()
      : null;
  try {
    const result = await getServerLiveRoster(serverId, instanceId);
    if (!result) {
      res.status(503).json({ ok: false, error: 'redis_unavailable' });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getLiveSummaryHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  try {
    const result = await getLiveSummary();
    if (!result) {
      res.status(503).json({ ok: false, error: 'redis_unavailable' });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function postAgentModsHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const instanceId = typeof req.params.instanceId === 'string' ? req.params.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }

  const body = (req.body ?? {}) as ModsInventorySnapshot;
  try {
    const meta = await storeModsInventory(instanceId, {
      cars: Array.isArray(body.cars) ? body.cars : [],
      tracks: Array.isArray(body.tracks) ? body.tracks : [],
      etag: typeof body.etag === 'string' ? body.etag : undefined,
      scannedAt: typeof body.scannedAt === 'number' ? body.scannedAt : undefined,
    });
    res.json({ ok: true, instanceId, meta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'redis_unavailable' ? 503 : 400;
    res.status(status).json({ ok: false, error: message });
  }
}

export async function getInstanceModsCarsHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const instanceId = typeof req.params.instanceId === 'string' ? req.params.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const result = await getModsCars(instanceId);
    if (!result) {
      res.status(503).json({ ok: false, error: 'redis_unavailable' });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getInstanceModsTracksHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const instanceId = typeof req.params.instanceId === 'string' ? req.params.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const result = await getModsTracks(instanceId);
    if (!result) {
      res.status(503).json({ ok: false, error: 'redis_unavailable' });
      return;
    }
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function postDesiredConfigHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }

  const payload: DesiredConfigBody = {
    instanceId,
    serverId: typeof body.serverId === 'string' ? body.serverId : undefined,
    configVersion: typeof body.configVersion === 'string' ? body.configVersion : undefined,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    config:
      body.config && typeof body.config === 'object'
        ? (body.config as WorkerConfigSnapshotResult)
        : undefined,
  };

  try {
    const result = await applyDesiredConfig(payload);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, instanceId, errors: [message] });
  }
}

export async function listServerSlotsHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const region = typeof req.query.region === 'string' ? req.query.region.trim() : undefined;
  const instanceId =
    typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : undefined;
  const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
  const status = statusRaw as ServerSlotStatus | undefined;
  try {
    const slots = await listServerSlots({ region, status, instanceId });
    res.json({ ok: true, servers: slots.map((s) => slotToJson(s)) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function upsertServerSlotHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  const region = typeof body.region === 'string' ? body.region.trim() : '';
  const lobbyName = typeof body.lobbyName === 'string' ? body.lobbyName.trim() : '';
  const folderSlug = typeof body.folderSlug === 'string' ? body.folderSlug.trim() : '';
  if (!instanceId || !region || !lobbyName || !folderSlug) {
    res.status(400).json({
      ok: false,
      error: 'instanceId_region_lobbyName_folderSlug_required',
    });
    return;
  }
  try {
    const slot = await upsertServerSlot({
      instanceId,
      region,
      lobbyName,
      folderSlug,
      status:
        typeof body.status === 'string' && body.status.trim()
          ? (body.status.trim() as ServerSlotStatus)
          : 'idle',
    });
    res.json({ ok: true, server: slotToJson(slot) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function allocateServerSlotHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const region = typeof body.region === 'string' ? body.region.trim() : '';
  if (!region) {
    res.status(400).json({ ok: false, error: 'region_required' });
    return;
  }
  const presetRef = typeof body.presetRef === 'string' ? body.presetRef.trim() : undefined;
  try {
    const slot = await allocateServerSlot({ region, presetRef });
    if (!slot) {
      res.status(409).json({ ok: false, error: 'no_idle_slot', region });
      return;
    }
    res.json({ ok: true, server: slotToJson(slot) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getServerSlotHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const slotId = typeof req.params.slotId === 'string' ? req.params.slotId.trim() : '';
  if (!slotId) {
    res.status(400).json({ ok: false, error: 'slotId_required' });
    return;
  }
  try {
    const slot = await getServerSlotById(slotId);
    if (!slot) {
      res.status(404).json({ ok: false, error: 'not_found', slotId });
      return;
    }
    res.json({ ok: true, server: slotToJson(slot) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function applyServerSlotConfigHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const slotId = typeof req.params.slotId === 'string' ? req.params.slotId.trim() : '';
  if (!slotId) {
    res.status(400).json({ ok: false, error: 'slotId_required' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await applySlotConfig({
      slotId,
      configVersion: typeof body.configVersion === 'string' ? body.configVersion : undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      config:
        body.config && typeof body.config === 'object'
          ? (body.config as WorkerConfigSnapshotResult)
          : undefined,
    });
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      server: slotToJson(result.slot ?? null),
      errors: result.errors,
      mode: result.mode,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

async function slotLifecycleHandler(
  req: Request,
  res: Response,
  action: SlotLifecycleAction,
): Promise<void> {
  if (!requireWorker(req, res) || !requireServerSlotsDb(res)) {
    return;
  }
  const slotId = typeof req.params.slotId === 'string' ? req.params.slotId.trim() : '';
  if (!slotId) {
    res.status(400).json({ ok: false, error: 'slotId_required' });
    return;
  }
  try {
    const result = await runSlotLifecycle(slotId, action);
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      server: slotToJson(result.slot ?? null),
      errors: result.errors,
      edge: result.edge,
      upstream: result.upstream,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function startServerSlotHandler(req: Request, res: Response): Promise<void> {
  await slotLifecycleHandler(req, res, 'start');
}

export async function stopServerSlotHandler(req: Request, res: Response): Promise<void> {
  await slotLifecycleHandler(req, res, 'stop');
}

export async function restartServerSlotHandler(req: Request, res: Response): Promise<void> {
  await slotLifecycleHandler(req, res, 'restart');
}
