import type { Request } from 'express';
import { isWorkerRequestAuthorized, readWorkerSecretFromRequest } from '../services/hud/hudWorkerAuth.js';
import { fleetEdgeSecret } from '../services/secrets/fleetSecrets.js';

export function readEdgeIdFromRequest(req: Request): string {
  const header = req.headers['x-edge-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim().toLowerCase();
  }
  const body = req.body as { edgeId?: unknown; edge_id?: unknown } | undefined;
  const value = body?.edgeId ?? body?.edge_id;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Hub mod-agent routes: worker secret + edge id header. */
export function isModAgentRequestAuthorized(req: Request): boolean {
  if (!isWorkerRequestAuthorized(req)) {
    return false;
  }
  return Boolean(readEdgeIdFromRequest(req));
}

/** Outbound edge → hub mod-agent headers (FLEET_EDGE_SECRET). */
export function modAgentAuthHeaders(edgeId: string): Record<string, string> {
  const secret = fleetEdgeSecret();
  return {
    'Content-Type': 'application/json',
    'X-Worker-Secret': secret,
    'X-Edge-Id': edgeId,
  };
}

export { readWorkerSecretFromRequest };
