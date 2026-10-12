/**
 * Fleet/hub-centric startup guards. Fail closed in production-like mode.
 * Hub↔edge auth readiness must match runtime: fleetEdgeSecret().
 */

import { fleetEdgeSecret } from '../secrets/fleetSecrets.js';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.trim().toLowerCase() === 'true' || raw === '1';
}

function isProductionLike(): boolean {
  const env = (process.env.ASSETTO_ENV || 'dev').trim().toLowerCase();
  return env === 'prod' || env === 'production';
}

function allowInsecure(): boolean {
  return envBool('ALLOW_INSECURE_DEFAULTS', false);
}

function isLocalRedisHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0';
}

export type FleetBootRole = 'edge' | 'hub';

export type FleetBootGuardResult = {
  errors: string[];
  warnings: string[];
};

/**
 * Validate fleet topology before binding HTTP.
 * - Hub-centric edges must not use localhost Redis (shared Redis required).
 * - BACKEND_INGEST/WORKER requires fleetEdgeSecret() (FLEET_EDGE_SECRET, or CONVEX fallback only when allowSecretFallback).
 * - CONVEX_DIRECT_ON_EDGE is lab-only in strict mode.
 * - Hub with empty FLEET_EDGE_REGISTRY warns (DB overlay may fill later).
 */
export function collectFleetBootGuards(role: FleetBootRole): FleetBootGuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const redisHost = (process.env.REDIS_HOST || '').trim();
  const backendIngest = (process.env.BACKEND_INGEST_URL || '').trim();
  const backendWorker = (process.env.BACKEND_WORKER_URL || '').trim();
  const hubCentric = Boolean(backendIngest || backendWorker);
  const workerSecret = fleetEdgeSecret();
  const directConvex = envBool('CONVEX_DIRECT_ON_EDGE', false);
  const fleetRaw = (process.env.FLEET_EDGE_REGISTRY || '').trim();

  if (role === 'edge' && hubCentric) {
    if (!redisHost) {
      errors.push('REDIS_HOST is required in hub-centric fleet mode');
    } else if (isLocalRedisHost(redisHost)) {
      errors.push(
        'REDIS_HOST points at localhost but BACKEND_INGEST_URL/BACKEND_WORKER_URL is set — fleet HUD/presence needs shared Redis',
      );
    }
    if (!workerSecret) {
      errors.push(
        'FLEET_EDGE_SECRET is required when BACKEND_INGEST_URL/BACKEND_WORKER_URL is set (CONVEX_WORKER_SECRET fallback only with ALLOW_INSECURE_DEFAULTS outside prod)',
      );
    }
    if (directConvex) {
      const msg =
        'CONVEX_DIRECT_ON_EDGE=true with hub URLs — dual path; disable for production fleet';
      if (isProductionLike() || !allowInsecure()) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  if (role === 'hub') {
    if (!redisHost) {
      errors.push('REDIS_HOST is required on the hub');
    }
    if (!workerSecret) {
      errors.push(
        'FLEET_EDGE_SECRET is required on the hub (CONVEX_WORKER_SECRET fallback only with ALLOW_INSECURE_DEFAULTS outside prod)',
      );
    }
    if (!fleetRaw) {
      warnings.push(
        'FLEET_EDGE_REGISTRY empty — hub will rely on DB fleet_edges / dynamic HUD registry after sync',
      );
    }
  }

  return { errors, warnings };
}

/** Apply guards: exit(1) on errors unless ALLOW_INSECURE_DEFAULTS (non-prod). */
export function assertFleetBootGuards(role: FleetBootRole): void {
  const { errors, warnings } = collectFleetBootGuards(role);
  const strict = isProductionLike() || !allowInsecure();

  for (const w of warnings) {
    console.warn(`[fleet-boot] ${w}`);
  }

  if (errors.length === 0) {
    return;
  }

  if (strict) {
    console.error(`[fleet-boot] configuration failed (role=${role}):`);
    for (const err of errors) {
      console.error(`   - ${err}`);
    }
    process.exit(1);
  }

  console.warn(`[fleet-boot] insecure overrides allowed (ALLOW_INSECURE_DEFAULTS=true):`);
  for (const err of errors) {
    console.warn(`   - ${err}`);
  }
}
