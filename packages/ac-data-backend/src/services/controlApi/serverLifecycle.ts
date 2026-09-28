import { postToEdgeWorker } from '@projectd/ac-data-shared/services/fleet/edgeWorkerForward.js';
import { resolveFleetEdgeByInstanceId } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { applyDesiredConfig } from './desiredConfig.js';
import {
  getServerSlotById,
  patchServerSlot,
  type ServerSlotRow,
} from './serverSlots.js';
import {
  ensureModsOnInstance,
  resolveConfigModTargets,
  waitUntilModsLocal,
} from '../mods/centralModLibrary.js';
import { isModDbConfigured } from '../mods/db.js';

const PROXY_TIMEOUT_MS = Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 120_000);

function workerSecret(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

type ConfigServerShape = {
  track?: string;
  cars?: string;
  entries?: Array<{ model?: string }>;
  serverId?: string;
  serverName?: string;
  isActive?: boolean;
};

function extractModConfigFromSlot(slot: ServerSlotRow): ConfigServerShape | null {
  const cfg = slot.appliedConfig;
  if (!cfg || typeof cfg !== 'object') {
    return null;
  }
  const root = cfg as Record<string, unknown>;
  if (typeof root.track === 'string' || Array.isArray(root.entries) || typeof root.cars === 'string') {
    return {
      track: typeof root.track === 'string' ? root.track : undefined,
      cars: typeof root.cars === 'string' ? root.cars : undefined,
      entries: Array.isArray(root.entries) ? (root.entries as Array<{ model?: string }>) : undefined,
    };
  }
  const servers = Array.isArray(root.servers) ? (root.servers as ConfigServerShape[]) : [];
  const match =
    servers.find(
      (s) =>
        s.serverId === slot.lobbyName ||
        s.serverName === slot.lobbyName ||
        s.serverId === slot.folderSlug,
    ) ?? servers.find((s) => s.isActive !== false) ??
    servers[0];
  return match ?? null;
}

/**
 * Ensure required central-library artifacts are LOCAL on the VPS before AC start.
 * Returns errors if ensure fails or wait times out — caller must not start AC.
 */
export async function ensureSlotModsReady(slot: ServerSlotRow): Promise<{
  ok: boolean;
  errors?: string[];
  items?: unknown[];
}> {
  if (!isModDbConfigured()) {
    return { ok: true };
  }
  const modConfig = extractModConfigFromSlot(slot);
  if (!modConfig) {
    return { ok: true };
  }
  const targets = await resolveConfigModTargets(modConfig);
  const hasTargets =
    (targets.cars?.length ?? 0) > 0 ||
    (targets.tracks?.length ?? 0) > 0 ||
    (targets.artifactIds?.length ?? 0) > 0;
  if (!hasTargets) {
    return { ok: true };
  }

  try {
    const ensured = await ensureModsOnInstance(slot.instanceId, targets);
    const pending = ensured.items.filter((i) => i.status !== 'LOCAL');
    if (pending.length === 0) {
      return { ok: true, items: ensured.items };
    }
    if (pending.some((i) => i.status === 'ERROR' || i.status === 'NOT_FOUND')) {
      return {
        ok: false,
        errors: [
          'MODS_NOT_READY',
          ...pending.map((i) => `${i.status}:${i.slug || i.artifactId}`),
        ],
        items: ensured.items,
      };
    }
    const artifactIds = ensured.items
      .filter((i) => i.status !== 'NOT_FOUND')
      .map((i) => i.artifactId);
    const waited = await waitUntilModsLocal(slot.instanceId, artifactIds);
    if (!waited.ready) {
      return {
        ok: false,
        errors: [
          'MODS_NOT_READY',
          ...waited.items
            .filter((i) => i.status !== 'LOCAL')
            .map((i) => `${i.status}:${i.slug || i.artifactId}`),
        ],
        items: waited.items,
      };
    }
    return { ok: true, items: waited.items };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: ['MODS_ENSURE_FAILED', message] };
  }
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

  // Prefetch required mods into local cache before push / AC start
  const previewSlot: ServerSlotRow = {
    ...slot,
    appliedConfig: (input.config as unknown as Record<string, unknown>) ?? slot.appliedConfig,
  };
  const modsGate = await ensureSlotModsReady(previewSlot);
  if (!modsGate.ok) {
    await patchServerSlot(slot.id, { status: 'error' });
    return {
      ok: false,
      slot,
      errors: modsGate.errors,
    };
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

  if (action === 'start' || action === 'restart') {
    const modsGate = await ensureSlotModsReady(slot);
    if (!modsGate.ok) {
      await patchServerSlot(slot.id, { status: 'error' });
      return {
        ok: false,
        slot,
        edge: edge.id,
        errors: modsGate.errors,
        upstream: { mods: modsGate.items },
      };
    }
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
