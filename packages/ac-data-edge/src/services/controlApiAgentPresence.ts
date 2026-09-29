import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listServerInstanceNames } from './serverBranding.js';
import { getServerRuntime } from './serverRuntime.js';

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || process.env.WORKER_INGEST_SECRET || '').trim();
}

function instanceId(): string {
  return (process.env.AC_INSTANCE_ID || 'default').trim() || 'default';
}

function region(): string {
  return (process.env.AC_REGION || process.env.FLEET_REGION || '').trim();
}

function agentVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Sole source of `servers[]` on register/heartbeat.
 * Feeds hub agent presence → Convex Host catalog `servers` sync
 * (`services/hostCatalog` on the hub). See docs/HOST_CATALOG_SYNC.md.
 */
export function listAgentPresenceServers(): Array<{
  serverId: string;
  name: string;
  status: string;
  playerCount: number;
}> {
  let names: string[] = [];
  try {
    names = listServerInstanceNames().filter((n) => n !== 'server-template');
  } catch {
    return [];
  }
  return names.map((name) => {
    let status = 'idle';
    try {
      const runtime = getServerRuntime(name);
      if (runtime.running) status = 'live';
    } catch {
      /* ignore */
    }
    return { serverId: name, name, status, playerCount: 0 };
  });
}

async function postAgent(pathSuffix: string, body: Record<string, unknown>): Promise<void> {
  const base = getHubWorkerBaseUrl();
  const secret = workerSecret();
  if (!base || !secret) {
    return;
  }
  const url = `${base.replace(/\/+$/, '')}${pathSuffix}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': secret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[control-api-agent] ${pathSuffix} failed status=${res.status} ${text.slice(0, 200)}`);
  }
}

export function isControlApiAgentPresenceEnabled(): boolean {
  const raw = (process.env.CONTROL_API_AGENT_PRESENCE_ENABLED || 'true').trim().toLowerCase();
  return raw !== 'false';
}

export function controlApiAgentHeartbeatMs(): number {
  return Number(process.env.CONTROL_API_AGENT_HEARTBEAT_MS || 20_000);
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function sendRegister(): Promise<void> {
  await postAgent('/v1/agents/register', {
    instanceId: instanceId(),
    region: region() || undefined,
    agentVersion: agentVersion(),
    servers: listAgentPresenceServers(),
  });
}

async function sendHeartbeat(): Promise<void> {
  await postAgent('/v1/agents/heartbeat', {
    instanceId: instanceId(),
    region: region() || undefined,
    agentVersion: agentVersion(),
    servers: listAgentPresenceServers(),
  });
}

export function startControlApiAgentPresenceLoop(): void {
  if (!isControlApiAgentPresenceEnabled()) {
    console.log('[control-api-agent] disabled (CONTROL_API_AGENT_PRESENCE_ENABLED=false)');
    return;
  }
  if (!getHubWorkerBaseUrl()) {
    console.log('[control-api-agent] skipped (no BACKEND_WORKER_URL / BACKEND_INGEST_URL)');
    return;
  }
  if (!workerSecret()) {
    console.log('[control-api-agent] skipped (no CONVEX_WORKER_SECRET)');
    return;
  }

  const intervalMs = controlApiAgentHeartbeatMs();
  console.log(`[control-api-agent] started heartbeatMs=${intervalMs} instanceId=${instanceId()}`);

  void sendRegister()
    .then(() => sendHeartbeat())
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[control-api-agent] initial register failed: ${message}`);
    });

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[control-api-agent] heartbeat failed: ${message}`);
    });
  }, intervalMs);
}
