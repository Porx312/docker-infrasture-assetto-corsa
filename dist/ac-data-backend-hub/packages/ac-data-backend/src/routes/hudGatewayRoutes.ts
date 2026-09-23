import { Router, type Request, type Response } from 'express';

import { buildHudBootstrapResponse } from '../services/hud/hudBootstrap.js';
import { proxyHudSnapshotIfGateway } from '../services/hud/hudGateway.js';

const router = Router();

router.get('/bootstrap', (req: Request, res: Response) => {
  const body = buildHudBootstrapResponse(req);
  if (!body.ok) {
    const status = body.reason === 'serverName required for HUD bootstrap' ? 400 : 404;
    res.status(status).json(body);
    return;
  }
  res.json(body);
});

router.get('/snapshot', (req: Request, res: Response) => {
  void proxyHudSnapshotIfGateway(req, res).catch((err: unknown) => {
    console.error('[hud-gateway] snapshot unhandled:', err);
    if (!res.headersSent) {
      res.status(503).json({ ok: false, reason: 'gateway_error' });
    }
  });
});

export default router;
