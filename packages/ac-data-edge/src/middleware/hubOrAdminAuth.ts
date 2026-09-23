import type { NextFunction, Request, Response } from 'express';
import { isWorkerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import { adminAuth } from './adminAuth.js';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  return raw.trim().toLowerCase() === 'true' || raw === '1';
}

/**
 * Hub proxy uses X-Worker-Secret; optional public admin JWT when EDGE_ADMIN_PUBLIC=true.
 */
export function hubOrAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (isWorkerRequestAuthorized(req)) {
    (req as Request & { adminUser?: string }).adminUser = 'hub';
    next();
    return;
  }
  if (envBool('EDGE_ADMIN_PUBLIC', false)) {
    adminAuth(req, res, next);
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    message: 'Edge admin API is restricted to hub proxy (worker secret)',
  });
}

export function isEdgeAdminPublicEnabled(): boolean {
  return envBool('EDGE_ADMIN_PUBLIC', false);
}
