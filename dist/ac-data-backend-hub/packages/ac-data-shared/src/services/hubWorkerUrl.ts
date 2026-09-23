import { isBackendIngestForwardConfigured } from './edgeIngestForward.js';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Hub base URL for worker RPC (queries, webhooks). Falls back to BACKEND_INGEST_URL. */
export function getHubWorkerBaseUrl(): string {
  const explicit = (process.env.BACKEND_WORKER_URL || '').trim();
  if (explicit) {
    return trimTrailingSlash(explicit);
  }
  const ingest = (process.env.BACKEND_INGEST_URL || '').trim();
  if (ingest) {
    return trimTrailingSlash(ingest);
  }
  return '';
}

/** Edge uses hub for worker Convex reads instead of local SDK. */
export function isHubWorkerMode(): boolean {
  return getHubWorkerBaseUrl().length > 0;
}

/** Dev override: edge keeps direct Convex even when BACKEND_WORKER_URL is set. */
export function isConvexDirectOnEdgeEnabled(): boolean {
  return (process.env.CONVEX_DIRECT_ON_EDGE || '').trim().toLowerCase() === 'true';
}

/** Edge should call Convex SDK locally (single-node dev). */
export function shouldEdgeUseDirectConvex(): boolean {
  if (isConvexDirectOnEdgeEnabled()) {
    return true;
  }
  if (isHubWorkerMode()) {
    return false;
  }
  return true;
}

export function isHubCentricEdgeMode(): boolean {
  return isBackendIngestForwardConfigured() || isHubWorkerMode();
}

/** Edge publishes config snapshots from Convex poll (disable when hub owns config). */
export function isEdgeConfigSyncEnabled(): boolean {
  const raw = (process.env.REDIS_CONFIG_SYNC_ON_EDGE || '').trim().toLowerCase();
  if (raw === 'false') {
    return false;
  }
  if (raw === 'true') {
    return true;
  }
  if (isHubWorkerMode() && !isConvexDirectOnEdgeEnabled()) {
    return false;
  }
  return true;
}

/** Backend hub publishes config (Convex → Redis and/or fleet edges). */
export function isHubConfigPublisherEnabled(): boolean {
  if ((process.env.REDIS_CONFIG_SYNC_ON_HUB || 'true').trim().toLowerCase() === 'false') {
    return false;
  }
  return Boolean((process.env.CONVEX_WORKER_SECRET || '').trim());
}
