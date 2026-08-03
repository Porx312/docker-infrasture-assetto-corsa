import { Router, type Request, type Response } from 'express';

import { handleHudStreamSse } from '../services/hud/hudStreamSse.js';
import { handleHudSnapshot } from '../services/hud/hudSnapshot.js';
import { refreshHudUserStatusFromConvex } from '../services/hud/hudUserStatusNotify.js';
import {
  isWorkerRequestAuthorized,
  readSteamIdFromWorkerRequest,
} from '../services/hud/hudWorkerAuth.js';

const router = Router();

router.get('/stream', (req: Request, res: Response) => {
  void handleHudStreamSse(req, res);
});

router.get('/snapshot', (req: Request, res: Response) => {
  void handleHudSnapshot(req, res);
});

/** Convex worker hook: re-fetch user ban + HUD session and push SSE (invalidate / re-validate). */
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

  void refreshHudUserStatusFromConvex(steamId)
    .then(() => {
      res.json({ ok: true, steamId });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[hud-worker] refresh-user failed steamId=${steamId}: ${message}`);
      res.status(500).json({ ok: false, error: message });
    });
});

export default router;
