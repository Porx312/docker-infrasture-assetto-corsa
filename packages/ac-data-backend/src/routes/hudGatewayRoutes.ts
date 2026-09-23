import { Router, type Request, type Response } from 'express';

import { buildHudBootstrapResponse } from '../services/hud/hudBootstrap.js';
import {
  proxyHudProfileCosmeticsFpIfGateway,
  proxyHudSnapshotIfGateway,
} from '../services/hud/hudGateway.js';

const router = Router();

router.get('/bootstrap', (req: Request, res: Response) => {
  void buildHudBootstrapResponse(req)
    .then((body) => {
      if (!body.ok) {
        const status =
          body.reason === 'steamId required for HUD bootstrap'
            ? 400
            : body.reason === 'redis_unavailable'
              ? 503
              : 404;
        res.status(status).json(body);
        return;
      }
      res.json(body);
    })
    .catch((err: unknown) => {
      console.error('[hud-gateway] bootstrap unhandled:', err);
      if (!res.headersSent) {
        res.status(503).json({ ok: false, reason: 'gateway_error' });
      }
    });
});

router.get('/snapshot', (req: Request, res: Response) => {
  void proxyHudSnapshotIfGateway(req, res).catch((err: unknown) => {
    console.error('[hud-gateway] snapshot unhandled:', err);
    if (!res.headersSent) {
      res.status(503).json({ ok: false, reason: 'gateway_error' });
    }
  });
});

router.get('/profile-cosmetics-fp', (req: Request, res: Response) => {
  void proxyHudProfileCosmeticsFpIfGateway(req, res).catch((err: unknown) => {
    console.error('[hud-gateway] profile-cosmetics-fp unhandled:', err);
    if (!res.headersSent) {
      res.status(503).json({ ok: false, reason: 'gateway_error' });
    }
  });
});

export default router;
