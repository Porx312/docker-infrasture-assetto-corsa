import type { Request, Response } from 'express';
import { getAcDataHealth } from '../services/healthService.js';

export async function getAdminHealthHandler(_req: Request, res: Response): Promise<void> {
  try {
    const health = await getAcDataHealth();
    res.status(health.ok ? 200 : 503).json({ ok: health.ok, health });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}
