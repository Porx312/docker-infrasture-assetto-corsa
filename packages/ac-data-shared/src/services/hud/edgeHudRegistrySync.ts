import { getHubWorkerBaseUrl, isHubWorkerMode } from '../hubWorkerUrl.js';
import type { HudRegistrySyncPayload } from './hudDynamicRegistryTypes.js';

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

export function isEdgeHudRegistrySyncConfigured(): boolean {
  return isHubWorkerMode() && Boolean(workerSecret());
}

export async function syncHudRegistryToHub(payload: HudRegistrySyncPayload): Promise<void> {
  const baseUrl = getHubWorkerBaseUrl();
  const secret = workerSecret();
  if (!baseUrl || !secret) {
    return;
  }

  const url = `${baseUrl}/hud/registry/sync`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': secret,
    },
    body: JSON.stringify({ workerSecret: secret, ...payload }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`hud registry sync failed HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}
