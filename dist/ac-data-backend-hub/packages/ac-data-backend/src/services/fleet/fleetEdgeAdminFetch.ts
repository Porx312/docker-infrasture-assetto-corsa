import type { FleetEdge } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';

const PROXY_TIMEOUT_MS = Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 120_000);

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

function buildAdminUrl(baseUrl: string, pathWithQuery: string): URL {
  return new URL(pathWithQuery, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

export async function fetchEdgeJson<T>(
  edge: FleetEdge,
  pathWithQuery: string,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const secret = workerSecret();
  if (!secret) {
    return { ok: false, status: 503, data: null, error: 'CONVEX_WORKER_SECRET missing' };
  }
  const url = buildAdminUrl(edge.baseUrl, pathWithQuery);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Worker-Secret': secret,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: await res.text() };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    return { ok: false, status: 502, data: null, error: message };
  }
}
