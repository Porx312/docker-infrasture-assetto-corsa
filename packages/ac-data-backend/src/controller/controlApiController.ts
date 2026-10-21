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
  backfillHostCatalogServers,
  syncHostCatalogServersFromPresence,
} from '../services/hostCatalog/index.js';
import {
  ensureModsOnInstance,
  getCentralModBySlug,
  getModsAvailability,
  listCentralMods,
  type EnsureRequest,
} from '../services/mods/centralModLibrary.js';
import { isModDbConfigured } from '../services/mods/db.js';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';
import type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import {
  handleLibrarySlimUploadCommit,
  handleLibrarySlimUploadPlan,
  handleLibrarySlimUploadPut,
} from '../services/mods/hubLibrarySlimUpload.js';
import { handleLibraryZipUpload } from '../services/mods/hubLibraryZipUpload.js';
import {
  isValidSteam64,
  listModsForSteam,
  normalizeSteamId,
} from '../services/mods/modSteamLinks.js';
import { unlinkSteamMod } from '../services/mods/unlinkSteamMod.js';
import { ModInUseError } from '../services/mods/orchestrator.js';

function requireModDb(res: Response): boolean {
  if (!isModDbConfigured()) {
    res.status(503).json({ ok: false, error: 'database_unavailable' });
    return false;
  }
  return true;
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
    const { expiresInSec, doc, previousServers } = await storeAgentPresence({
      instanceId,
      region,
      agentVersion: typeof body.agentVersion === 'string' ? body.agentVersion : undefined,
      servers,
      isHeartbeat: false,
    });
    void syncHostCatalogServersFromPresence({
      instanceId: doc.instanceId,
      previous: previousServers,
      current: doc.servers,
      region: doc.region,
    }).catch((err: unknown) => {
      console.warn(
        '[control-api] syncHostCatalogServersFromPresence failed:',
        err instanceof Error ? err.message : err,
      );
    });
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
    const { expiresInSec, doc, previousServers } = await storeAgentPresence({
      instanceId,
      region,
      agentVersion: typeof body.agentVersion === 'string' ? body.agentVersion : undefined,
      servers,
      isHeartbeat: true,
    });
    void syncHostCatalogServersFromPresence({
      instanceId: doc.instanceId,
      previous: previousServers,
      current: doc.servers,
      region: doc.region,
    }).catch((err: unknown) => {
      console.warn(
        '[control-api] syncHostCatalogServersFromPresence failed:',
        err instanceof Error ? err.message : err,
      );
    });
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

/** Central library catalog — Hub Postgres (not VPS inventory). */
export async function listCentralModsHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireModDb(res)) {
    return;
  }
  const kindRaw = typeof req.query.kind === 'string' ? req.query.kind.trim() : '';
  const kind = (['car', 'track', 'weather', 'misc'] as ModKind[]).includes(kindRaw as ModKind)
    ? (kindRaw as ModKind)
    : undefined;
  try {
    const mods = await listCentralMods(kind);
    res.json({ ok: true, mods });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getCentralModBySlugHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireModDb(res)) {
    return;
  }
  const slug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
  if (!slug) {
    res.status(400).json({ ok: false, error: 'slug_required' });
    return;
  }
  try {
    const mod = await getCentralModBySlug(slug);
    if (!mod) {
      res.status(404).json({ ok: false, error: 'not_found', slug });
      return;
    }
    res.json({ ok: true, mod });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ ok: false, error: message });
  }
}

export async function getModsAvailabilityHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireModDb(res)) {
    return;
  }
  const instanceId =
    typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  try {
    const result = await getModsAvailability(instanceId);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'fleet_edge_not_found' ? 404 : 503;
    res.status(status).json({ ok: false, error: message });
  }
}

export async function ensureInstanceModsHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res) || !requireModDb(res)) {
    return;
  }
  const instanceId =
    typeof req.params.instanceId === 'string' ? req.params.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  const body = (req.body ?? {}) as EnsureRequest;
  try {
    const result = await ensureModsOnInstance(instanceId, body);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === 'fleet_edge_not_found' ? 404 : message === 'database_unavailable' ? 503 : 400;
    res.status(status).json({ ok: false, error: message });
  }
}

export async function postHostCatalogSyncServersHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireWorker(req, res)) {
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId_required' });
    return;
  }
  const region = typeof body.region === 'string' ? body.region.trim() : undefined;
  const servers = parseAgentServers(body.servers);
  try {
    const result = await backfillHostCatalogServers({
      instanceId,
      region,
      servers,
    });
    const status = result.ok ? 200 : result.error === 'host_catalog_sync_disabled' || result.error?.includes('disabled') || result.error?.includes('CONVEX') ? 503 : 400;
    res.status(status).json({
      ok: result.ok,
      instanceId: result.instanceId,
      upserted: result.upserted,
      deleted: result.deleted,
      errors: result.errors.length ? result.errors : undefined,
      error: result.error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
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

/** User library ZIP upload — hub does slim + hash + S3 + steam link. */
export async function controlLibraryZipUploadHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  await handleLibraryZipUpload(req, res);
}

/** User library slim-upload (Convex BFF). Links package to steamId; no host-catalog. */
export async function controlLibrarySlimUploadPlanHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  await handleLibrarySlimUploadPlan(req, res, { mode: 'control' });
}

export async function controlLibrarySlimUploadFileHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  await handleLibrarySlimUploadPut(req, res);
}

export async function controlLibrarySlimUploadCommitHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  await handleLibrarySlimUploadCommit(req, res, { mode: 'control' });
}

export async function listModsBySteamHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  const steamId = normalizeSteamId(req.params.steamId);
  if (!isValidSteam64(steamId)) {
    res.status(400).json({ ok: false, error: 'invalid_steam_id' });
    return;
  }
  try {
    const items = await listModsForSteam(steamId);
    res.json({ ok: true, steamId, items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
}

export async function unlinkSteamLibraryModHandler(req: Request, res: Response): Promise<void> {
  if (!requireWorker(req, res)) return;
  if (!requireModDb(res)) return;
  const packageId = String(req.params.packageId || '').trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const steamId = normalizeSteamId(
    body.steamId ?? body.steam_id ?? req.query.steamId ?? req.query.steam_id,
  );
  if (!packageId) {
    res.status(400).json({ ok: false, error: 'packageId_required' });
    return;
  }
  if (!isValidSteam64(steamId)) {
    res.status(400).json({ ok: false, error: 'invalid_steam_id' });
    return;
  }
  try {
    const result = await unlinkSteamMod(steamId, packageId);
    if (result.status === 'unlinked') {
      const purgeSkipped = result.purgeSkipped;
      res.json({
        ok: true,
        status: 'unlinked',
        packageId: result.packageId,
        remainingLinks: result.remainingLinks,
        ...(purgeSkipped
          ? {
              purgeSkipped,
              usage: result.usage,
              message:
                'Removed from your library; package kept because a requiring server is still running (or status unknown)',
            }
          : {
              message:
                result.remainingLinks > 0
                  ? 'Removed from your library; other users still use this mod'
                  : 'Removed from your library',
            }),
      });
      return;
    }
    res.json({
      ok: true,
      status: 'purged',
      packageId: result.packageId,
      displayName: result.displayName,
      edgesPurged: result.edgesPurged,
      edgesFailed: result.edgesFailed,
      message: 'Last user — deleted from library (S3 + VPS); Convex catalog slug kept',
    });
  } catch (err: unknown) {
    if (err instanceof ModInUseError) {
      // Admin-style purge paths may still throw; user unlink no longer uses 409 for list removal.
      res.status(409).json({
        ok: false,
        error: 'mod_in_use',
        message:
          'Mod is still required by a running server; stop those servers (or remove the mod from their config) first',
        usage: err.usage,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'link_not_found') {
      res.status(404).json({ ok: false, error: 'link_not_found', message });
      return;
    }
    if (message === 'package_not_found') {
      res.status(404).json({ ok: false, error: 'package_not_found', message });
      return;
    }
    res.status(400).json({ ok: false, error: message });
  }
}
