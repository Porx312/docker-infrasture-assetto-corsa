import { Router, type Request, type Response } from 'express';

import type { HudRegistrySyncPayload } from '@projectd/ac-data-shared/services/hud/hudDynamicRegistryTypes.js';
import { isWorkerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import { applyHudRegistrySync } from '../services/hud/hudDynamicRegistry.js';

const router = Router();

router.post('/sync', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const body = req.body as HudRegistrySyncPayload & { workerSecret?: string };
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const publicBaseUrl =
    typeof body.publicBaseUrl === 'string' ? body.publicBaseUrl.trim() : undefined;
  const servers = Array.isArray(body.servers) ? body.servers : [];

  if (!instanceId || !baseUrl) {
    res.status(400).json({ ok: false, error: 'instanceId and baseUrl required' });
    return;
  }

  void applyHudRegistrySync({ instanceId, baseUrl, publicBaseUrl, servers })
    .then((result) => {
      res.json(result);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    });
});

export default router;
