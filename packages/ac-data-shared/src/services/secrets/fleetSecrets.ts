/**
 * Split fleet secrets.
 *
 * - FLEET_EDGE_SECRET: hub↔edge proxy, worker routes, inventory POST
 * - MOD_PEER_SECRET: edge↔edge blob peer pull
 * - CONVEX_WORKER_SECRET: Convex worker queries only
 *
 * Fallbacks to CONVEX_WORKER_SECRET are allowed only with ALLOW_INSECURE_DEFAULTS
 * outside production-like ASSETTO_ENV.
 */

import crypto from 'node:crypto';
import { allowSecretFallback } from '../../config/env.js';

export function convexWorkerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

/** Hub↔edge admin proxy / agent / inventory. */
export function fleetEdgeSecret(): string {
  const dedicated = (process.env.FLEET_EDGE_SECRET || '').trim();
  if (dedicated) return dedicated;
  if (allowSecretFallback()) return convexWorkerSecret();
  return '';
}

/** Peer blob download between edges. */
export function modPeerSecret(): string {
  const dedicated = (process.env.MOD_PEER_SECRET || '').trim();
  if (dedicated) return dedicated;
  const fleet = (process.env.FLEET_EDGE_SECRET || '').trim();
  if (fleet && allowSecretFallback()) return fleet;
  if (allowSecretFallback()) return convexWorkerSecret();
  return '';
}

/** Constant-time compare of secret strings (hashes first so lengths need not match). */
export function secretsMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
