import { postToEdgeWorker } from '@projectd/ac-data-shared/services/fleet/edgeWorkerForward.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { applyDesiredConfig } from './desiredConfig.js';
import {
  getServerSlotById,
  patchServerSlot,
  type ServerSlotRow,
} from './serverSlots.js';

const PROXY_TIMEOUT_MS = Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 120_000);

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

async function postEdgeAdmin(
  edgeBaseUrl: string,
  adminPath: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const secret = workerSecret();
  if (!secret) {
    return { ok: false, status: 503, data: { error: 'CONVEX_WORKER_SECRET_missing' } };
  }
  const base = edgeBaseUrl.replace(/\/+$/, '');
  const path = adminPath.startsWith('/') ? adminPath : `/${adminPath}`;
  const url = `${base}/admin${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret,
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'edge_unreachable';
    return { ok: false, status: 502, data: { error: message } };
  }
}

export type ApplySlotConfigInput = {
  slotId: string;
  config?: WorkerConfigSnapshotResult;
  configVersion?: string;
  reason?: string;
};

export async function applySlotConfig(input: ApplySlotConfigInput): Promise<{
  ok: boolean;
  slot?: ServerSlotRow;
  errors?: string[];
  mode?: string;
}> {
  const slot = await getServerSlotById(input.slotId);
  if (!slot) {
    return { ok: false, errors: ['slot_not_found'] };
  }

  const result = await applyDesiredConfig({
    instanceId: slot.instanceId,
    serverId: slot.lobbyName,
    configVersion: input.configVersion,
    reason: input.reason || 'slot_apply_config',
    config: input.config,
  });

  if (!result.ok) {
    await patchServerSlot(slot.id, { status: 'error' });
    return {
      ok: false,
      slot,
      errors: result.errors,
      mode: result.mode,
    };
  }

  const appliedConfig =
    input.config ??
    ({
      instanceId: slot.instanceId,
      reason: input.reason || 'slot_apply_config',
      lobbyName: slot.lobbyName,
      folderSlug: slot.folderSlug,
      presetRef: slot.presetRef,
      appliedAt: Date.now(),
    } as unknown);

  const updated = await patchServerSlot(slot.id, {
    appliedConfig,
    status: slot.status === 'idle' ? 'allocated' : slot.status,
  });

  return {
    ok: true,
    slot: updated ?? slot,
    mode: result.mode,
  };
}

export type SlotLifecycleAction = 'start' | 'stop' | 'restart';

export async function runSlotLifecycle(
  slotId: string,
  action: SlotLifecycleAction,
): Promise<{
  ok: boolean;
  slot?: ServerSlotRow;
  errors?: string[];
  edge?: string;
  upstream?: unknown;
}> {
  const slot = await getServerSlotById(slotId);
  if (!slot) {
    return { ok: false, errors: ['slot_not_found'] };
  }

  const edge = resolveFleetEdgeByInstanceId(slot.instanceId);
  if (!edge) {
    return {
      ok: false,
      slot,
      errors: ['fleet_edge_not_found'],
    };
  }

  const name = encodeURIComponent(slot.folderSlug);
  const upstream = await postEdgeAdmin(edge.baseUrl, `/servers/${name}/${action}`);
  if (!upstream.ok) {
    await patchServerSlot(slot.id, { status: 'error' });
    return {
      ok: false,
      slot,
      edge: edge.id,
      errors: [`edge_${action}_failed:${upstream.status}`],
      upstream: upstream.data,
    };
  }

  let nextStatus: ServerSlotRow['status'] = slot.status;
  if (action === 'start' || action === 'restart') {
    nextStatus = 'live';
  } else if (action === 'stop') {
    nextStatus = 'idle';
  }

  const updated = await patchServerSlot(slot.id, {
    status: nextStatus,
    ...(action === 'stop' ? { presetRef: null, playerCount: 0 } : {}),
  });

  return {
    ok: true,
    slot: updated ?? slot,
    edge: edge.id,
    upstream: upstream.data,
  };
}

/** Optional: also push via worker path if admin start is unavailable. */
export async function pushConfigViaWorkerFallback(
  slot: ServerSlotRow,
  snapshot: WorkerConfigSnapshotResult,
  reason: string,
): Promise<{ ok: boolean; status: number }> {
  const edge = resolveFleetEdgeByInstanceId(slot.instanceId);
  if (!edge) {
    return { ok: false, status: 404 };
  }
  const forward = await postToEdgeWorker(edge.baseUrl, '/hud/worker/push-config-snapshot', {
    instanceId: slot.instanceId,
    snapshot,
    reason,
  });
  return { ok: forward.ok, status: forward.status };
}
