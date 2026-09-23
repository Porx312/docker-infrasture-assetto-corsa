import {
  isEdgeHudRegistrySyncConfigured,
  syncHudRegistryToHub,
} from '@projectd/ac-data-shared/services/hud/edgeHudRegistrySync.js';
import type { HudRegistryServerRow } from '@projectd/ac-data-shared/services/hud/hudDynamicRegistryTypes.js';
import { listManagedServersForRegistry } from './hudManagedServers.js';

function acInstanceId(): string {
  return (process.env.AC_INSTANCE_ID || 'default').trim();
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function resolveEdgeBaseUrlForRegistry(): string {
  const fromEnv = (process.env.EDGE_REGISTRY_BASE_URL || '').trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  const port = process.env.PORT || '3000';
  const host = process.env.AC_DATA_BIND_HOST || '127.0.0.1';
  const bindHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return trimTrailingSlash(`http://${bindHost}:${port}`);
}

function resolveEdgePublicBaseUrl(): string {
  const fromEnv = (process.env.EDGE_PUBLIC_BASE_URL || '').trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  return resolveEdgeBaseUrlForRegistry();
}

export async function publishHudRegistryToHubIfConfigured(): Promise<void> {
  if (!isEdgeHudRegistrySyncConfigured()) {
    return;
  }

  const servers: HudRegistryServerRow[] = listManagedServersForRegistry();
  const payload = {
    instanceId: acInstanceId(),
    baseUrl: resolveEdgeBaseUrlForRegistry(),
    publicBaseUrl: resolveEdgePublicBaseUrl(),
    servers,
  };

  await syncHudRegistryToHub(payload);
  console.log(
    `[hud-registry-sync] hub updated instance=${payload.instanceId} servers=${servers.length}`,
  );
}
