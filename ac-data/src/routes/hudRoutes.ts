import { Router, type Request, type Response } from 'express';

import { refreshConfigFromConvex } from '../services/configSyncFromConvex.js';
import { handleHudProfileCosmeticsFp } from '../services/hud/hudCosmeticsFp.js';
import { handleHudSnapshot } from '../services/hud/hudSnapshot.js';
import { refreshHudUserStatusFromConvex } from '../services/hud/hudUserStatusNotify.js';
import { getHudConvexQueryStats } from '../services/hud/hudConvexQueryStats.js';
import {
  isWorkerRequestAuthorized,
  readInstanceIdFromWorkerRequest,
  readOptionalStringField,
  readSteamIdFromWorkerRequest,
} from '../services/hud/hudWorkerAuth.js';

function acInstanceId(): string {
  return (process.env.AC_INSTANCE_ID || 'default').trim();
}

const router = Router();

router.get('/snapshot', (req: Request, res: Response) => {
  void handleHudSnapshot(req, res).catch((err: unknown) => {
    console.error('[hud] snapshot unhandled:', err);
    if (!res.headersSent) {
      res.status(503).json({ ok: false, reason: 'convex_unreachable' });
    }
  });
});

router.get('/profile-cosmetics-fp', (req: Request, res: Response) => {
  void handleHudProfileCosmeticsFp(req, res).catch((err: unknown) => {
    console.error('[hud] profile-cosmetics-fp unhandled:', err);
    if (!res.headersSent) {
      res.status(503).json({ ok: false, reason: 'redis_unreachable' });
    }
  });
});

/** Convex worker hook: re-fetch user ban + HUD session and push WSS (invalidate / re-validate). */
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

  const body = req.body as { reason?: unknown } | undefined;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : undefined;

  console.log(
    `[hud-worker] refresh-user steamId=${steamId}${reason ? ` reason=${reason}` : ''}`,
  );

  void refreshHudUserStatusFromConvex(steamId, {
    publishEnforcement: true,
    reason,
  })
    .then(() => {
      res.json({ ok: true, steamId });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[hud-worker] refresh-user failed steamId=${steamId}: ${message}`);
      res.status(503).json({ ok: false, convexRefreshFailed: true, error: message, steamId });
    });
});

/** Convex worker hook: fetch server configs and publish Redis snapshot for this VPS. */
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
  if (instanceId !== acInstanceId()) {
    res.status(404).json({ ok: false, error: 'instance_mismatch', instanceId, expected: acInstanceId() });
    return;
  }

  const configVersion = readOptionalStringField(req, 'configVersion');
  const reason = readOptionalStringField(req, 'reason') || 'webhook';

  console.log(
    `[hud-worker] refresh-config instanceId=${instanceId}${configVersion ? ` configVersion=${configVersion}` : ''} reason=${reason}`,
  );

  void refreshConfigFromConvex({
    expectedConfigVersion: configVersion || undefined,
    reason,
    force: !configVersion,
  })
    .then((result) => {
      res.json({
        ok: true,
        instanceId,
        published: result.published,
        configVersion: result.configVersion,
        snapshotVersion: result.snapshotVersion ?? null,
        totalServers: result.totalServers ?? null,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[hud-worker] refresh-config failed instanceId=${instanceId}: ${message}`);
      res.status(503).json({ ok: false, convexRefreshFailed: true, error: message, instanceId });
    });
});

/** Worker diagnostics: in-process Convex HUD query counters (since ac-data start). */
router.get('/worker/convex-query-stats', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  res.json({ ok: true, ...getHudConvexQueryStats() });
});

export default router;
