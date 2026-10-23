import type { Request } from 'express';

import { envBool, isProductionLike } from '../../config/env.js';
import { fleetEdgeSecret, modPeerSecret, secretsMatch } from '../secrets/fleetSecrets.js';

/** Body workerSecret only when explicitly allowed (dev / legacy). Off in production-like. */
export function allowBodyWorkerSecret(): boolean {
  if (isProductionLike()) return false;
  const raw = process.env.ALLOW_BODY_WORKER_SECRET;
  if (raw !== undefined && raw.trim() !== '') {
    return raw.trim().toLowerCase() === 'true' || raw === '1';
  }
  // Dev default: allow legacy body unless insecure flag is off and we want header-only.
  return envBool('ALLOW_BODY_WORKER_SECRET', true);
}

/**
 * Prefer `x-worker-secret` / `X-Worker-Secret` header.
 * Body `workerSecret` only when allowBodyWorkerSecret() is true.
 */
export function readWorkerSecretFromRequest(req: Request): string {
  const header = req.headers['x-worker-secret'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  if (allowBodyWorkerSecret()) {
    const body = req.body as { workerSecret?: unknown } | undefined;
    if (typeof body?.workerSecret === 'string' && body.workerSecret.trim()) {
      return body.workerSecret.trim();
    }
  }
  return '';
}

/** Hub↔edge / agent / inventory auth (FLEET_EDGE_SECRET || CONVEX_WORKER_SECRET). */
export function isWorkerRequestAuthorized(req: Request): boolean {
  return secretsMatch(readWorkerSecretFromRequest(req), fleetEdgeSecret());
}

/** Edge↔edge peer blob auth (MOD_PEER_SECRET with fallbacks). */
export function isModPeerRequestAuthorized(req: Request): boolean {
  return secretsMatch(readWorkerSecretFromRequest(req), modPeerSecret());
}

export function readInstanceIdFromWorkerRequest(req: Request): string {
  const body = req.body as { instanceId?: unknown; instance_id?: unknown } | undefined;
  const value = body?.instanceId ?? body?.instance_id;
  return typeof value === 'string' ? value.trim() : '';
}

export function readSteamIdFromWorkerRequest(req: Request): string {
  const body = req.body as { steamId?: unknown; steam_id?: unknown } | undefined;
  const value = body?.steamId ?? body?.steam_id;
  return typeof value === 'string' ? value.trim() : '';
}

export function readOptionalStringField(req: Request, key: string): string {
  const body = req.body as Record<string, unknown> | undefined;
  const value = body?.[key];
  return typeof value === 'string' ? value.trim() : '';
}
