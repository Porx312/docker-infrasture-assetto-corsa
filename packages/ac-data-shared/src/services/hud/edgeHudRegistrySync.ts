import { getHubWorkerBaseUrl, isHubWorkerMode } from '../hubWorkerUrl.js';
import { fleetEdgeSecret } from '../secrets/fleetSecrets.js';
import type { HudRegistrySyncPayload } from './hudDynamicRegistryTypes.js';

export function isEdgeHudRegistrySyncConfigured(): boolean {
  return isHubWorkerMode() && Boolean(fleetEdgeSecret());
}

export async function syncHudRegistryToHub(payload: HudRegistrySyncPayload): Promise<void> {
  const baseUrl = getHubWorkerBaseUrl();
  const secret = fleetEdgeSecret();
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
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`hud registry sync failed HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}
