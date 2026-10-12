import { fleetEdgeSecret } from '../secrets/fleetSecrets.js';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Hub → edge worker hook (refresh-user, push-config, etc.). Auth: FLEET_EDGE_SECRET. */
export async function postToEdgeWorker(
  edgeBaseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const secret = fleetEdgeSecret();
  if (!secret) {
    throw new Error('FLEET_EDGE_SECRET or CONVEX_WORKER_SECRET missing for edge forward');
  }
  const base = trimTrailingSlash(edgeBaseUrl);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed };
}
