import type { NextFunction, Request, Response } from 'express';
import { isWorkerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';

/**
 * Edge admin JSON API is hub-proxy only (X-Worker-Secret).
 * Admin UI lives exclusively on ac-data-backend.
 */
export function hubOrAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (isWorkerRequestAuthorized(req)) {
    (req as Request & { adminUser?: string }).adminUser = 'hub';
    next();
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    message: 'Edge admin API is restricted to hub proxy (worker secret)',
  });
}
