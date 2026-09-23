import type { Request, Response } from 'express';
import { isFleetModeEnabled } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { proxyAdminRequestToEdge } from './edgeAdminProxy.js';
import { isHubOwnsContent } from './hubFleetConfig.js';

export function readFleetEdgeIdFromRequest(req: Request): string | undefined {
  const header = req.headers['x-fleet-edge'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  const query = req.query.fleetEdge;
  if (typeof query === 'string' && query.trim()) {
    return query.trim();
  }
  return undefined;
}

/** Skip fleet proxy for hub-local content/HUD admin routes. */
export function shouldSkipFleetProxyForHubContent(req: Request): boolean {
  if (!isFleetModeEnabled() || !isHubOwnsContent()) {
    return false;
  }
  const path = req.path;
  return (
    path.startsWith('/content') ||
    path.startsWith('/upload') ||
    path.startsWith('/preview') ||
    path.startsWith('/hud/releases')
  );
}

/** Proxy to selected edge when fleet mode is on. Returns true if response was sent. */
export async function proxyFleetAdminIfNeeded(req: Request, res: Response): Promise<boolean> {
  if (shouldSkipFleetProxyForHubContent(req)) {
    return false;
  }
  if (!isFleetModeEnabled()) {
    return false;
  }
  const edgeId = readFleetEdgeIdFromRequest(req);
  if (!edgeId) {
    res.status(400).json({
      ok: false,
      message: 'Select a VPS (fleetEdge query or X-Fleet-Edge header required)',
    });
    return true;
  }
  await proxyAdminRequestToEdge(edgeId, req, res);
  return true;
}
