import { Router, type Request, type Response } from 'express';

import {
  isWorkerRequestAuthorized,
  readInstanceIdFromWorkerRequest,
  readSteamIdFromWorkerRequest,
} from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import { readHudWorkerPresenceFromBody } from '@projectd/ac-data-shared/services/hud/hudWorkerPresence.js';
import {
  isWorkerConvexQueryConfigured,
  queryHudSession,
  queryHudVersion,
  queryPlayerJoinContext,
  queryWorkerConfigSnapshot,
  queryWorkerSyncVersion,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';

const router = Router();

function unauthorized(res: Response): void {
  res.status(401).json({ ok: false, error: 'unauthorized' });
}

function convexUnavailable(res: Response): void {
  res.status(503).json({ ok: false, error: 'convex_not_configured' });
}

router.post('/sync-version', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (!isWorkerConvexQueryConfigured()) {
    convexUnavailable(res);
    return;
  }
  const instanceId = readInstanceIdFromWorkerRequest(req) || 'default';
  void queryWorkerSyncVersion(instanceId)
    .then((sync) => {
      res.json({ ok: true, sync });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

router.post('/player-join-context', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (!isWorkerConvexQueryConfigured()) {
    convexUnavailable(res);
    return;
  }
  const steamId = readSteamIdFromWorkerRequest(req);
  if (!steamId) {
    res.status(400).json({ ok: false, error: 'steamId required' });
    return;
  }
  const presence = readHudWorkerPresenceFromBody(req.body);
  void queryPlayerJoinContext(steamId, presence)
    .then((result) => {
      res.json({ ok: true, result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

router.post('/hud-session', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (!isWorkerConvexQueryConfigured()) {
    convexUnavailable(res);
    return;
  }
  const steamId = readSteamIdFromWorkerRequest(req);
  if (!steamId) {
    res.status(400).json({ ok: false, error: 'steamId required' });
    return;
  }
  const presence = readHudWorkerPresenceFromBody(req.body);
  void queryHudSession(steamId, presence)
    .then((result) => {
      res.json({ ok: true, result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

router.post('/hud-version', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (!isWorkerConvexQueryConfigured()) {
    convexUnavailable(res);
    return;
  }
  const steamId = readSteamIdFromWorkerRequest(req);
  if (!steamId) {
    res.status(400).json({ ok: false, error: 'steamId required' });
    return;
  }
  const body = req.body as { now?: unknown } | undefined;
  const now = typeof body?.now === 'number' && Number.isFinite(body.now) ? body.now : undefined;
  const presence = readHudWorkerPresenceFromBody(req.body);
  void queryHudVersion(steamId, now, presence)
    .then((result) => {
      res.json({ ok: true, result });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

router.post('/config-snapshot', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    unauthorized(res);
    return;
  }
  if (!isWorkerConvexQueryConfigured()) {
    convexUnavailable(res);
    return;
  }
  const instanceId = readInstanceIdFromWorkerRequest(req);
  if (!instanceId) {
    res.status(400).json({ ok: false, error: 'instanceId required' });
    return;
  }
  void queryWorkerConfigSnapshot(instanceId)
    .then((snapshot) => {
      res.json({ ok: true, snapshot });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

export default router;
