import { getHubWorkerBaseUrl } from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { fleetEdgeSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listServerInstanceNames } from '@projectd/ac-data-shared/services/serverBranding.js';
import { getServerRuntime } from './serverRuntime.js';
import {
  coarseStatusForPhase,
  getServerLifecycle,
  setLifecycleHeartbeatPublisher,
} from './serverLifecycle.js';

function workerSecret(): string {
  return fleetEdgeSecret();
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

export type AgentPresenceServerSlot = {
  serverId: string;
  name: string;
  status: string;
  playerCount: number;
  httpPort?: number;
  phase?: string;
  phaseDetail?: string;
  phaseUpdatedAt?: number;
};

/**
 * Sole source of `servers[]` on register/heartbeat.
 * Feeds hub agent presence → Convex Host catalog `servers` sync
 * (`services/hostCatalog` on the hub). See docs/HOST_CATALOG_SYNC.md.
 *
 * Lifecycle `phase` (when set) drives coarse `status` and is not overridden by
 * runtime.running alone.
 */
export function listAgentPresenceServers(): AgentPresenceServerSlot[] {
  let names: string[] = [];
  try {
    names = listServerInstanceNames().filter((n) => n !== 'server-template');
  } catch {
    return [];
  }
  return names.map((name) => {
    let status = 'idle';
    let httpPort: number | undefined;
    let running = false;
    try {
      const runtime = getServerRuntime(name);
      running = runtime.running;
      if (
        typeof runtime.httpPort === 'number' &&
        Number.isFinite(runtime.httpPort) &&
        runtime.httpPort > 0
      ) {
        httpPort = Math.trunc(runtime.httpPort);
      }
    } catch {
      /* ignore */
    }

    const life = getServerLifecycle(name);
    if (life) {
      status = coarseStatusForPhase(life.phase);
    } else if (running) {
      status = 'live';
    }

    return {
      serverId: name,
      name,
      status,
      playerCount: 0,
      ...(httpPort != null ? { httpPort } : {}),
      ...(life
        ? {
            phase: life.phase,
            ...(life.phaseDetail ? { phaseDetail: life.phaseDetail } : {}),
            phaseUpdatedAt: life.phaseUpdatedAt,
          }
        : {}),
    };
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

/** Immediate heartbeat (used by server lifecycle phase changes). */
export async function forceAgentHeartbeat(): Promise<void> {
  if (!isControlApiAgentPresenceEnabled()) return;
  if (!getHubWorkerBaseUrl() || !workerSecret()) return;
  await sendHeartbeat();
}

// Default publisher so lifecycle updates force a heartbeat even before the loop starts.
setLifecycleHeartbeatPublisher(() => forceAgentHeartbeat());

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
    console.log('[control-api-agent] skipped (no FLEET_EDGE_SECRET)');
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
