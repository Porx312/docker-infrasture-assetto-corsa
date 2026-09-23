import { Router, type Request, type Response } from 'express';

import { postToEdgeWorker } from '@projectd/ac-data-shared/services/fleet/edgeWorkerForward.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import {
  isWorkerRequestAuthorized,
  readInstanceIdFromWorkerRequest,
  readOptionalStringField,
  readSteamIdFromWorkerRequest,
} from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import {
  isWorkerConvexQueryConfigured,
  queryWorkerConfigSnapshot,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { publishConfigSnapshotToHubRedis } from '../services/hubConfigSync.js';

const router = Router();

/** Convex webhook entry: refresh HUD user on the target edge VPS. */
router.post('/worker/refresh-user', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const steamId = readSteamIdFromWorkerRequest(req);
  if (!steamId) {
    res.status(400).json({ ok: false, error: 'steamId required' });
    return;
  }

  const instanceId = readInstanceIdFromWorkerRequest(req);
  const edge = instanceId ? resolveFleetEdgeByInstanceId(instanceId) : null;
  if (!edge) {
    res.status(404).json({ ok: false, error: 'edge_not_found', instanceId: instanceId || null });
    return;
  }

  const reason = readOptionalStringField(req, 'reason');

  void postToEdgeWorker(edge.baseUrl, '/hud/worker/refresh-user', {
    steamId,
    ...(reason ? { reason } : {}),
    ...(instanceId ? { instanceId } : {}),
  })
    .then(({ ok, status, body }) => {
      if (!ok) {
        res.status(status >= 400 ? status : 502).json(body);
        return;
      }
      res.json(body);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

/** Convex webhook entry: fetch config from Convex and push to edge (or hub Redis). */
router.post('/worker/refresh-config', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const instanceId = readInstanceIdFromWorkerRequest(req);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId required' });
    return;
  }

  const configVersion = readOptionalStringField(req, 'configVersion');
  const reason = readOptionalStringField(req, 'reason') || 'webhook';

  if (!isWorkerConvexQueryConfigured()) {
    res.status(503).json({ ok: false, error: 'convex_not_configured' });
    return;
  }

  void (async () => {
    const snapshot = await queryWorkerConfigSnapshot(instanceId);
    const edge = resolveFleetEdgeByInstanceId(instanceId);

    if (edge) {
      const forward = await postToEdgeWorker(edge.baseUrl, '/hud/worker/push-config-snapshot', {
        instanceId,
        snapshot,
        reason,
        ...(configVersion ? { configVersion } : {}),
      });
      if (!forward.ok) {
        res.status(forward.status >= 400 ? forward.status : 502).json(forward.body);
        return;
      }
      res.json({ ok: true, mode: 'edge_push', instanceId, edge: edge.id, ...(forward.body as object) });
      return;
    }

    await publishConfigSnapshotToHubRedis(snapshot);
    res.json({ ok: true, mode: 'hub_redis', instanceId });
  })()
    .then(() => {})
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

export default router;
