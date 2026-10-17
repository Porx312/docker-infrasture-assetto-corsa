import type { Request, Response } from 'express';
import { getAcDataHealth, type AcDataHealth } from '../services/healthService.js';

export type HealthHandlerDeps = {
  getHealth: () => Promise<AcDataHealth>;
};

/**
 * Process liveness — no Redis/Convex/Postgres. Safe for systemd/process managers
 * that must not restart solely because a dependency is down.
 */
export function getPublicLiveHandler(_req: Request, res: Response): void {
  res.status(200).json({ ok: true });
}

/**
 * Dependency readiness (Redis when configured). Prefer /api/live for process liveness.
 * Do not wire systemd Restart= to this endpoint alone.
 */
export function createPublicHealthHandler(
  deps: HealthHandlerDeps = { getHealth: getAcDataHealth },
): (_req: Request, res: Response) => Promise<void> {
  return async (_req, res) => {
    try {
      const health = await deps.getHealth();
      res.status(health.ok ? 200 : 503).json({ ok: health.ok });
    } catch {
      res.status(503).json({ ok: false });
    }
  };
}

export const getPublicHealthHandler = createPublicHealthHandler();

export function createAdminHealthHandler(
  deps: HealthHandlerDeps = { getHealth: getAcDataHealth },
): (_req: Request, res: Response) => Promise<void> {
  return async (_req, res) => {
    try {
      const health = await deps.getHealth();
      res.status(health.ok ? 200 : 503).json({ ok: health.ok, health });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ ok: false, message });
    }
  };
}

export const getAdminHealthHandler = createAdminHealthHandler();
