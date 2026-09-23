function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Hub → edge worker hook (refresh-user, push-config, etc.). */
export async function postToEdgeWorker(
  edgeBaseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const secret = workerSecret();
  if (!secret) {
    throw new Error('CONVEX_WORKER_SECRET missing for edge forward');
  }
  const base = trimTrailingSlash(edgeBaseUrl);
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify({ workerSecret: secret, ...body }),
  });
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed };
}
