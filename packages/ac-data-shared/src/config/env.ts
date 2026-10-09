/**
 * Typed env helpers for fleet/HUD (subset). Prefer these over ad-hoc process.env reads
 * for new code; migrate hot paths gradually.
 */

export function envString(name: string, fallback = ''): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

export function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.trim().toLowerCase() === 'true' || raw === '1';
}

export function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name] || fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function isProductionLike(): boolean {
  const env = envString('ASSETTO_ENV', 'dev').toLowerCase();
  return env === 'prod' || env === 'production';
}

export function allowInsecureDefaults(): boolean {
  return envBool('ALLOW_INSECURE_DEFAULTS', false);
}

/** True when secret fallbacks (CONVEX_WORKER_SECRET → fleet/peer) are allowed. */
export function allowSecretFallback(): boolean {
  return allowInsecureDefaults() && !isProductionLike();
}

export function redisHost(): string {
  return envString('REDIS_HOST');
}

export function fleetEdgeRegistryRaw(): string {
  return envString('FLEET_EDGE_REGISTRY');
}

/** @deprecated Static lobby map — prefer dynamic registry + FLEET_EDGE_REGISTRY bootstrap. */
export function hudEdgeRegistryRaw(): string {
  return envString('HUD_EDGE_REGISTRY');
}

export function backendIngestUrl(): string {
  return envString('BACKEND_INGEST_URL');
}

export function backendWorkerUrl(): string {
  return envString('BACKEND_WORKER_URL');
}

export function isHubCentricEdge(): boolean {
  return Boolean(backendIngestUrl() || backendWorkerUrl());
}

export function liveIngestConvex(): boolean {
  return envBool('LIVE_INGEST_CONVEX', false);
}

export function hudAllowLegacyServerNameRouting(): boolean {
  return envBool('HUD_ALLOW_LEGACY_SERVERNAME_ROUTING', false);
}
