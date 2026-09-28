import type { ModAgentJobPayload } from '@projectd/ac-data-shared/mods/types.js';
import { modAgentAuthHeaders } from '@projectd/ac-data-shared/mods/modAgentAuth.js';
import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';

function edgeId(): string {
  return (process.env.EDGE_ID || process.env.FLEET_EDGE_ID || 'default').trim().toLowerCase();
}

function hubApiBase(): string {
  const base = getHubWorkerBaseUrl();
  if (!base) {
    throw new Error('BACKEND_WORKER_URL or BACKEND_INGEST_URL not configured');
  }
  return `${base.replace(/\/+$/, '')}/api`;
}

async function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${hubApiBase()}${path}`;
  const headers: Record<string, string> = {
    ...modAgentAuthHeaders(edgeId()),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...init, headers });
}

export async function agentHeartbeat(diskFreeBytes?: number): Promise<void> {
  const res = await hubFetch('/mod-agent/v1/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ diskFreeBytes, agentVersion: '1' }),
  });
  if (!res.ok) {
    throw new Error(`heartbeat failed: ${res.status}`);
  }
}

export async function acquireModJob(agentId: string): Promise<ModAgentJobPayload | null> {
  const res = await hubFetch('/mod-agent/v1/jobs/acquire', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`acquire job failed: ${res.status}`);
  }
  const body = (await res.json()) as { job?: ModAgentJobPayload };
  return body.job ?? null;
}

export async function getArtifactDownloadUrl(artifactId: string): Promise<{
  url: string;
  sha256: string;
  sizeBytes: number;
}> {
  const res = await hubFetch(`/mod-agent/v1/artifacts/${artifactId}/download-url`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`download-url failed: ${res.status}`);
  }
  return (await res.json()) as { url: string; sha256: string; sizeBytes: number };
}

export async function reportJobProgress(jobId: string, progressPct: number, phase: string): Promise<void> {
  const res = await hubFetch(`/mod-agent/v1/jobs/${jobId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ progressPct, phase }),
  });
  if (!res.ok) {
    throw new Error(`progress failed: ${res.status}`);
  }
}

export async function completeModJob(jobId: string, installedSha256: string): Promise<void> {
  const res = await hubFetch(`/mod-agent/v1/jobs/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ installedSha256 }),
  });
  if (!res.ok) {
    throw new Error(`complete job failed: ${res.status}`);
  }
}

export async function failModJob(
  jobId: string,
  errorCode: string,
  errorMessage: string,
  retriable: boolean,
): Promise<void> {
  const res = await hubFetch(`/mod-agent/v1/jobs/${jobId}/fail`, {
    method: 'POST',
    body: JSON.stringify({ errorCode, errorMessage, retriable }),
  });
  if (!res.ok) {
    throw new Error(`fail job failed: ${res.status}`);
  }
}

export async function refreshServerModsOnHub(input: {
  serverName: string;
  track?: string;
  cars?: string;
}): Promise<{ ready: boolean; items: Array<{ acContentSlug: string; status: string }> }> {
  const res = await hubFetch(
    `/mod-agent/v1/servers/${encodeURIComponent(input.serverName)}/mods/refresh`,
    {
      method: 'POST',
      body: JSON.stringify({
        track: input.track,
        cars: input.cars,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`mods refresh failed: ${res.status}`);
  }
  return (await res.json()) as { ready: boolean; items: Array<{ acContentSlug: string; status: string }> };
}

export function isModAgentEnabled(): boolean {
  return (process.env.MOD_AGENT_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export function getModEdgeId(): string {
  return edgeId();
}
