import { getHubWorkerBaseUrl, isHubWorkerMode } from './hubWorkerUrl.js';

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

export function isEdgeHubWorkerClientConfigured(): boolean {
  return isHubWorkerMode() && Boolean(workerSecret());
}

async function postHubWorker<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const baseUrl = getHubWorkerBaseUrl();
  const secret = workerSecret();
  if (!baseUrl) {
    throw new Error('BACKEND_WORKER_URL or BACKEND_INGEST_URL missing');
  }
  if (!secret) {
    throw new Error('CONVEX_WORKER_SECRET missing for hub worker client');
  }

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify({ workerSecret: secret, ...body }),
  });

  const json = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok) {
    const message =
      typeof json === 'object' && json && 'error' in json && typeof json.error === 'string'
        ? json.error
        : `hub worker HTTP ${response.status}`;
    throw new Error(message);
  }

  return json;
}

export async function hubFetchWorkerSyncVersion(instanceId: string): Promise<unknown> {
  return postHubWorker('/worker/sync-version', { instanceId });
}

export async function hubFetchPlayerJoinContext(steamId: string): Promise<unknown> {
  return postHubWorker('/worker/player-join-context', { steamId });
}

export async function hubFetchHudSession(steamId: string): Promise<unknown> {
  return postHubWorker('/worker/hud-session', { steamId });
}

export async function hubFetchHudVersion(steamId: string, now?: number): Promise<unknown> {
  return postHubWorker('/worker/hud-version', {
    steamId,
    ...(now !== undefined ? { now } : {}),
  });
}
