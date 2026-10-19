import '@projectd/ac-data-shared/config/loadEnv.js';
import type { RedisClientType } from 'redis';
import {
  activeServers,
  applyServerConfiguration,
  cleanupOrphanProcesses,
  stopServerCore,
  ServerConfigPayload,
} from '../controller/controller.js';
import { normalizeTrackConfigForIni } from '@projectd/ac-data-shared/controller/trackConfig.js';
import { stripCspTrackPrefix } from '@projectd/ac-data-shared/mods/cspTrack.js';
import { shouldStartFromConfig } from './serverPool.js';
import { buildConfigSignature } from '@projectd/ac-data-shared/services/configApplierLogic.js';
import {
  hasServerBrandingUpdate,
  pickServerBrandingUpdate,
  updateServerInstanceConfig,
} from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
import {
  updateManagedServersFromSnapshot,
  type ManagedServerRow,
} from './hud/hudManagedServers.js';
import { connectRedisClient, createRedisClient, isRedisConfigured } from '@projectd/ac-data-shared/services/redisClient.js';
import {
  CONFIG_DLQ_STREAM_KEY,
  processConfigApplyOutcome,
  type ConfigAckRedis,
} from './configApplierAck.js';
import {
  filterValidEntries,
  getAvailableCars,
  resolveEntriesForApply,
} from './configCarAvailability.js';
import {
  UNRECOVERABLE_MODS_REASON,
  type ModContentOverrides,
} from './modAgent/startGate.js';

const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

// Each VPS uses its own consumer group so every node receives every snapshot.
// A shared group would have Redis route each message to a single consumer,
// causing other VPS to miss config updates for their own instanceId.
const APPLIER_GROUP =
  process.env.REDIS_CONFIG_APPLIER_GROUP || `ac-data-config-appliers-${AC_INSTANCE_ID}`;
const APPLIER_CONSUMER =
  process.env.REDIS_CONFIG_APPLIER_NAME || `applier-${AC_INSTANCE_ID}`;
const APPLIER_ENABLED =
  (process.env.REDIS_CONFIG_APPLIER_ENABLED || 'true').trim().toLowerCase() === 'true';
const RESTART_ON_BOOT =
  (process.env.REDIS_CONFIG_APPLIER_RESTART_ON_BOOT || 'false').trim().toLowerCase() === 'true';
const PENDING_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.REDIS_CONFIG_APPLIER_PENDING_MAX_ATTEMPTS || 8),
);
/** Backoff delays (ms) between pending reconcile retries after S3/mod skip. */
const PENDING_BACKOFF_MS = [30_000, 60_000, 120_000, 180_000, 300_000, 300_000, 300_000, 300_000];
const APPLIER_PENDING_RECLAIM_MIN_IDLE_MS = Math.max(
  10_000,
  Number(process.env.REDIS_CONFIG_APPLIER_PENDING_RECLAIM_MIN_IDLE_MS || 60_000),
);
const APPLIER_PENDING_RECLAIM_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.REDIS_CONFIG_APPLIER_PENDING_RECLAIM_INTERVAL_MS || 310_000),
);
const APPLIER_PENDING_RECLAIM_BATCH = Math.max(
  1,
  Number(process.env.REDIS_CONFIG_APPLIER_PENDING_RECLAIM_BATCH || 20),
);

type ServerRow = {
  serverId?: string;
  serverName: string;
  displayName?: string;
  type?: string;
  isActive?: boolean;
  instanceId?: string;
  password?: string;
  maxClients?: number;
  rotationEnabled?: boolean;
  track?: string;
  trackName?: string;
  trackConfig?: string;
  entries?: Array<{ model: string; skin?: string; count?: number }>;
  updatedAt?: number;
  description?: string;
  webLink?: string;
  cmDescriptionBody?: string;
  bannerImageUrl?: string;
  loadingImageUrl?: string;
  loadingImageUrls?: string[];
};

type StreamMessage = {
  id: string;
  fields?: Record<string, string>;
  message?: Record<string, string>;
};

type StreamReadResult = Array<{
  name: string;
  messages: StreamMessage[];
}>;

const lastSignatures = new Map<string, string>();

type PendingReconcile = {
  row: ServerRow;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
};

/** Servers waiting for CONTENT_PATH mods before apply/start (create→S3 race). */
const pendingReconcileByServer = new Map<string, PendingReconcile>();

export type ReconcileOutcome = 'applied' | 'pending_mods' | 'skipped' | 'error';

function parsePayload(message: StreamMessage): Record<string, unknown> | null {
  const raw = message.fields?.payload ?? message.message?.payload;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildSignature(row: ServerRow): string {
  return buildConfigSignature(row);
}

function rowToConfigPayload(row: ServerRow): ServerConfigPayload {
  const payload: ServerConfigPayload = {};
  if (row.displayName !== undefined) payload.displayName = row.displayName;
  if (row.password !== undefined) payload.password = row.password;
  if (row.track !== undefined) payload.track = row.track;
  if (row.trackConfig !== undefined) {
    payload.configTrack = normalizeTrackConfigForIni(row.trackConfig);
  }
  if (row.maxClients !== undefined) payload.maxClients = row.maxClients;
  if (row.entries !== undefined) payload.entries = row.entries;
  if (row.description !== undefined) payload.description = row.description;
  if (row.webLink !== undefined) payload.webLink = row.webLink;
  if (row.cmDescriptionBody !== undefined) payload.cmDescriptionBody = row.cmDescriptionBody;
  if (row.bannerImageUrl !== undefined) payload.bannerImageUrl = row.bannerImageUrl;
  if (row.loadingImageUrl !== undefined) payload.loadingImageUrl = row.loadingImageUrl;
  if (row.loadingImageUrls !== undefined) payload.loadingImageUrls = row.loadingImageUrls;
  return payload;
}

async function applyServerBrandingIfPresent(row: ServerRow): Promise<string[]> {
  const brandingUpdate = pickServerBrandingUpdate(row as Record<string, unknown>);
  if (!hasServerBrandingUpdate(brandingUpdate)) {
    return [];
  }
  await updateServerInstanceConfig(row.serverName, brandingUpdate);
  return ['description/branding'];
}

/** Track + car models from Redis row (before server_cfg.ini is rewritten). */
export function contentOverridesFromRow(row: ServerRow): ModContentOverrides {
  const models = [
    ...new Set(
      (row.entries || [])
        .map((e) => (typeof e.model === 'string' ? e.model.trim() : ''))
        .filter(Boolean),
    ),
  ];
  const overrides: ModContentOverrides = {};
  const trackSlug = stripCspTrackPrefix(row.track || '');
  if (trackSlug) overrides.track = trackSlug;
  if (models.length) overrides.cars = models.join(';');
  return overrides;
}

type PreflightResult = 'ok' | 'pending_mods' | 'unrecoverable';

/**
 * Download track/cars from hub/S3 using Redis slugs before the local-car gate.
 */
async function preflightModsForRow(row: ServerRow): Promise<PreflightResult> {
  if (row.isActive === false) {
    return 'ok';
  }
  const overrides = contentOverridesFromRow(row);
  if (!overrides.track && !overrides.cars) {
    return 'ok';
  }

  const { ensureModsReadyForServerStart, localContentExists, requiredSlugsFromConfig } =
    await import('./modAgent/startGate.js');
  const required = requiredSlugsFromConfig(overrides);
  if (required.length > 0 && required.every((slug) => localContentExists(slug))) {
    // Folder may exist before extract finishes — still require usable cars when entries set.
    if (row.entries && row.entries.length > 0) {
      const { valid } = filterValidEntries(row.entries, getAvailableCars());
      if (valid.length === 0) {
        console.warn(
          `[redis-config-applier] ${row.serverName}: content dirs present but cars not ready — pending retry`,
        );
        return 'pending_mods';
      }
    }
    return 'ok';
  }

  const gate = await ensureModsReadyForServerStart(row.serverName, overrides);
  if (gate.ok) {
    return 'ok';
  }

  const missing = (gate.items || []).map((i) => `${i.acContentSlug}(${i.status})`).join(',');
  console.warn(
    `[redis-config-applier] preflight mods ${row.serverName}: ${gate.reason || 'not_ready'} missing=${missing}`,
  );

  if (gate.reason === UNRECOVERABLE_MODS_REASON || gate.reason === 'unknown_package') {
    return 'unrecoverable';
  }

  if (row.entries && row.entries.length > 0) {
    const { valid } = filterValidEntries(row.entries, getAvailableCars());
    if (valid.length === 0) {
      console.warn(
        `[redis-config-applier] ${row.serverName}: still no local cars after preflight — pending retry`,
      );
      return 'pending_mods';
    }
  }
  // Track-only / partial: treat timeout as pending so we retry after mod-agent finishes.
  if (gate.reason === 'install_timeout' || gate.code === 'MODS_NOT_READY') {
    return 'pending_mods';
  }
  return 'ok';
}

function clearPendingReconcile(serverName: string): void {
  const pending = pendingReconcileByServer.get(serverName);
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  pendingReconcileByServer.delete(serverName);
}

function schedulePendingReconcile(row: ServerRow, reason: string): void {
  const name = row.serverName;
  const existing = pendingReconcileByServer.get(name);
  const attempts = existing ? existing.attempts + 1 : 1;
  if (existing?.timer) clearTimeout(existing.timer);

  if (attempts > PENDING_MAX_ATTEMPTS) {
    console.warn(
      `[redis-config-applier] ${name}: giving up pending reconcile after ${PENDING_MAX_ATTEMPTS} attempts (${reason})`,
    );
    pendingReconcileByServer.delete(name);
    return;
  }

  const delay = PENDING_BACKOFF_MS[Math.min(attempts - 1, PENDING_BACKOFF_MS.length - 1)] ?? 60_000;
  console.log(
    `[redis-config-applier] ${name}: schedule pending reconcile #${attempts} in ${Math.round(delay / 1000)}s (${reason})`,
  );

  const timer = setTimeout(() => {
    const cur = pendingReconcileByServer.get(name);
    if (!cur) return;
    void reconcileServer(cur.row, false)
      .then((outcome) => {
        if (outcome === 'pending_mods') {
          schedulePendingReconcile(cur.row, 'retry_still_pending');
        }
      })
      .catch((err: unknown) => {
        console.error(`[redis-config-applier] pending reconcile ${name} error:`, err);
        schedulePendingReconcile(cur.row, 'retry_error');
      });
  }, delay);

  pendingReconcileByServer.set(name, { row: { ...row }, attempts, timer });
}

/**
 * Call after mod-agent installs content so skipped apply/start can run without a new hub push.
 */
export function notifyContentReadyForConfigApplier(slugs?: string[]): void {
  const needle = (slugs || []).map((s) => s.trim()).filter(Boolean);
  const names = [...pendingReconcileByServer.keys()];
  for (const name of names) {
    const pending = pendingReconcileByServer.get(name);
    if (!pending) continue;
    if (needle.length) {
      const overrides = contentOverridesFromRow(pending.row);
      const required = [
        ...(overrides.track ? [overrides.track] : []),
        ...(overrides.cars ? overrides.cars.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : []),
      ];
      if (required.length && !required.some((s) => needle.includes(s))) {
        continue;
      }
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    console.log(`[redis-config-applier] ${name}: content ready — flushing pending reconcile`);
    void reconcileServer(pending.row, false)
      .then((outcome) => {
        if (outcome === 'pending_mods') {
          schedulePendingReconcile(pending.row, 'flush_still_pending');
        }
      })
      .catch((err: unknown) => {
        console.error(`[redis-config-applier] flush pending ${name} error:`, err);
        schedulePendingReconcile(pending.row, 'flush_error');
      });
  }
}

/** Test helper */
export function _resetPendingReconcileForTests(): void {
  for (const pending of pendingReconcileByServer.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  pendingReconcileByServer.clear();
}

export function _pendingReconcileCountForTests(): number {
  return pendingReconcileByServer.size;
}

async function reconcileServer(
  row: ServerRow,
  isFirstSnapshot: boolean,
): Promise<ReconcileOutcome> {
  if (!row || !row.serverName) return 'skipped';
  if (row.instanceId && row.instanceId !== AC_INSTANCE_ID) return 'skipped';

  // Install from S3/hub first — otherwise resolveEntriesForApply aborts when 0 cars are local
  // and we never reach startServerWithMods.
  const preflight = await preflightModsForRow(row);
  if (preflight === 'unrecoverable') {
    clearPendingReconcile(row.serverName);
    return 'skipped';
  }
  if (preflight === 'pending_mods') {
    schedulePendingReconcile(row, 'preflight_mods');
    return 'pending_mods';
  }

  let entries: ReturnType<typeof resolveEntriesForApply>;
  try {
    const availableCars = getAvailableCars();
    // Throws if desired entries exist but none are local — avoid name/track-only apply leaving stale cars.
    entries = resolveEntriesForApply(row.entries, availableCars, row.serverName);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[redis-config-applier] ${message} — pending retry`);
    schedulePendingReconcile(row, 'no_valid_cars');
    return 'pending_mods';
  }
  if (entries !== undefined) {
    row = { ...row, entries };
  }

  const contentOverrides = contentOverridesFromRow(row);
  const signature = buildSignature(row);
  const previous = lastSignatures.get(row.serverName);
  const changed = previous !== signature;
  const running = !!activeServers[row.serverName]?.pid;

  if (!changed && !isFirstSnapshot) {
    try {
      const brandingMods = await applyServerBrandingIfPresent(row);
      if (brandingMods.length) {
        console.log(
          `[redis-config-applier] applyBranding ${row.serverName} (sig unchanged): ${brandingMods.join(', ')}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[redis-config-applier] applyBranding ${row.serverName} failed: ${message}`);
    }
    // Still need start if we skipped earlier while mods downloaded (signature unchanged).
    if (!running && shouldStartFromConfig(row.isActive) && !(isFirstSnapshot && !RESTART_ON_BOOT)) {
      const { startServerWithMods } = await import('./modAgent/startGate.js');
      const result = await startServerWithMods(row.serverName, contentOverrides);
      console.log(
        `[redis-config-applier] start ${row.serverName} (sig unchanged, was down): ${result.ok ? 'ok' : 'failed'} | ${result.message}${
          result.ok
            ? ''
            : result.code === 'MODS_NOT_READY'
              ? ` missing=${(result.missing || []).map((m) => m.acContentSlug).join(',')}`
              : ''
        }`,
      );
      if (!result.ok && result.code === 'MODS_NOT_READY') {
        schedulePendingReconcile(row, 'start_mods_not_ready');
        return 'pending_mods';
      }
    }
    clearPendingReconcile(row.serverName);
    return 'applied';
  }

  if (row.isActive === false) {
    if (running) {
      const result = await stopServerCore(row.serverName);
      console.log(
        `[redis-config-applier] stop ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}`,
      );
    } else {
      console.log(`[redis-config-applier] ${row.serverName} inactive (no process to stop)`);
    }
    try {
      const brandingMods = await applyServerBrandingIfPresent(row);
      if (brandingMods.length) {
        console.log(
          `[redis-config-applier] applyBranding ${row.serverName} (inactive): ${brandingMods.join(', ')}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[redis-config-applier] applyBranding ${row.serverName} failed: ${message}`);
    }
    lastSignatures.set(row.serverName, signature);
    clearPendingReconcile(row.serverName);
    return 'applied';
  }

  if (!shouldStartFromConfig(row.isActive)) {
    const apply = applyServerConfiguration(row.serverName, rowToConfigPayload(row));
    if (!apply.ok) {
      console.warn(`[redis-config-applier] applyConfig ${row.serverName} failed: ${apply.reason}`);
    } else if (apply.modifications.length) {
      console.log(
        `[redis-config-applier] applyConfig ${row.serverName} (pool idle): ${apply.modifications.join(', ')}`,
      );
    }
    try {
      const brandingMods = await applyServerBrandingIfPresent(row);
      if (brandingMods.length) {
        console.log(
          `[redis-config-applier] applyBranding ${row.serverName} (pool idle): ${brandingMods.join(', ')}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[redis-config-applier] applyBranding ${row.serverName} failed: ${message}`);
    }
    if (running) {
      const result = await stopServerCore(row.serverName);
      console.log(
        `[redis-config-applier] pool stop ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}`,
      );
    }
    lastSignatures.set(row.serverName, signature);
    clearPendingReconcile(row.serverName);
    return 'applied';
  }

  const apply = applyServerConfiguration(row.serverName, rowToConfigPayload(row));
  if (!apply.ok) {
    console.warn(`[redis-config-applier] applyConfig ${row.serverName} failed: ${apply.reason}`);
  } else if (apply.modifications.length) {
    console.log(
      `[redis-config-applier] applyConfig ${row.serverName} updated: ${apply.modifications.join(', ')}`,
    );
  }

  try {
    const brandingMods = await applyServerBrandingIfPresent(row);
    if (brandingMods.length) {
      console.log(
        `[redis-config-applier] applyBranding ${row.serverName}: ${brandingMods.join(', ')}`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[redis-config-applier] applyBranding ${row.serverName} failed: ${message}`);
  }

  if (running && changed) {
    const { restartServerWithMods } = await import('./modAgent/startGate.js');
    const result = await restartServerWithMods(row.serverName, contentOverrides);
    console.log(
      `[redis-config-applier] restart ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}${
        result.ok ? '' : result.code === 'MODS_NOT_READY' ? ` missing=${(result.missing || []).map((m) => m.acContentSlug).join(',')}` : ''
      }`,
    );
    if (!result.ok && result.code === 'MODS_NOT_READY') {
      schedulePendingReconcile(row, 'restart_mods_not_ready');
      return 'pending_mods';
    }
  } else if (!running) {
    if (isFirstSnapshot && !RESTART_ON_BOOT) {
      console.log(`[redis-config-applier] ${row.serverName} first snapshot skip (RESTART_ON_BOOT=false)`);
    } else {
      const { startServerWithMods } = await import('./modAgent/startGate.js');
      const result = await startServerWithMods(row.serverName, contentOverrides);
      console.log(
        `[redis-config-applier] start ${row.serverName}: ${result.ok ? 'ok' : 'failed'} | ${result.message}${
          result.ok ? '' : result.code === 'MODS_NOT_READY' ? ` missing=${(result.missing || []).map((m) => m.acContentSlug).join(',')}` : ''
        }`,
      );
      if (!result.ok && result.code === 'MODS_NOT_READY') {
        schedulePendingReconcile(row, 'start_mods_not_ready');
        return 'pending_mods';
      }
    }
  } else {
    console.log(`[redis-config-applier] ${row.serverName} already running, config${changed ? ' changed' : ' unchanged'}`);
  }

  lastSignatures.set(row.serverName, signature);
  clearPendingReconcile(row.serverName);
  return 'applied';
}

/**
 * Fail-closed: missing/blank instanceId must not apply (would fan out to every VPS).
 * Foreign instanceId is a no-op (still ACKed by the caller).
 */
export function shouldApplyConfigSnapshot(
  payload: Record<string, unknown>,
  instanceId: string = AC_INSTANCE_ID,
): { apply: boolean; reason?: 'missing_instance_id' | 'foreign_instance_id' } {
  const data = (payload.data as Record<string, unknown>) ?? {};
  const snapshotInstance = String(data.instanceId ?? payload.instanceId ?? '').trim();
  if (!snapshotInstance) {
    return { apply: false, reason: 'missing_instance_id' };
  }
  if (snapshotInstance !== instanceId) {
    return { apply: false, reason: 'foreign_instance_id' };
  }
  return { apply: true };
}

async function handleSnapshot(payload: Record<string, unknown>, isFirstSnapshot: boolean): Promise<void> {
  const gate = shouldApplyConfigSnapshot(payload);
  if (!gate.apply) {
    if (gate.reason === 'missing_instance_id') {
      console.warn('[redis-config-applier] snapshot missing instanceId — rejected (fail-closed)');
    }
    return;
  }

  const data = (payload.data as Record<string, unknown>) ?? {};
  const rows = (data.servers as ServerRow[]) ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return;

  updateManagedServersFromSnapshot(rows as ManagedServerRow[]);

  for (const row of rows) {
    try {
      await reconcileServer(row, isFirstSnapshot);
    } catch (err) {
      console.error(`[redis-config-applier] reconcile ${row?.serverName} error:`, err);
    }
  }
}

async function processApplierStreamMessage(
  client: RedisClientType,
  ackRedis: ConfigAckRedis,
  msg: StreamMessage,
  state: { isFirstSnapshot: boolean },
): Promise<void> {
  const payload = parsePayload(msg);
  if (!payload || payload.event !== 'server_config_snapshot') {
    await client.xAck(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP, msg.id);
    return;
  }
  const rawFields = msg.fields ?? msg.message ?? {};
  const payloadJson =
    typeof rawFields.payload === 'string' ? rawFields.payload : JSON.stringify(payload);
  let applyOk = false;
  let applyError: string | null = null;
  try {
    await handleSnapshot(payload, state.isFirstSnapshot);
    applyOk = true;
    state.isFirstSnapshot = false;
  } catch (err) {
    applyError = err instanceof Error ? err.message : String(err);
    console.error('[redis-config-applier] snapshot handler error:', err);
  }
  try {
    const outcome = await processConfigApplyOutcome({
      redis: ackRedis,
      streamKey: REDIS_CONFIG_STREAM_KEY,
      group: APPLIER_GROUP,
      msgId: msg.id,
      instanceId: AC_INSTANCE_ID,
      payloadJson,
      applyError,
      applyOk,
      dlqStreamKey: CONFIG_DLQ_STREAM_KEY,
    });
    if (outcome.decision.action === 'nack') {
      console.warn(
        `[redis-config-applier] leave unacked msg=${msg.id} fails=${outcome.failCount} (PEL reclaim)`,
      );
    } else if (outcome.decision.action === 'dlq_failed') {
      console.error(
        `[redis-config-applier] DLQ write failed (left unacked) msg=${msg.id}: ${outcome.decision.reason}`,
      );
    } else if (outcome.decision.action === 'dlq_then_ack') {
      console.error(
        `[redis-config-applier] poison → DLQ ${CONFIG_DLQ_STREAM_KEY} originalMsgId=${msg.id} dlqId=${outcome.dlqId} (at-least-once; may duplicate if crash before XACK)`,
      );
    }
  } catch (ackErr) {
    console.error('[redis-config-applier] ack/dlq path error (left unacked):', ackErr);
  }
}

/** Reclaim stale PEL entries stuck after crash between XREAD and XACK. */
async function reclaimStaleApplierPending(
  client: RedisClientType,
  ackRedis: ConfigAckRedis,
  state: { isFirstSnapshot: boolean },
): Promise<number> {
  let reclaimed = 0;
  let cursor = '0-0';
  while (reclaimed < APPLIER_PENDING_RECLAIM_BATCH) {
    const raw = await client.xAutoClaim(
      REDIS_CONFIG_STREAM_KEY,
      APPLIER_GROUP,
      APPLIER_CONSUMER,
      APPLIER_PENDING_RECLAIM_MIN_IDLE_MS,
      cursor,
      { COUNT: Math.min(5, APPLIER_PENDING_RECLAIM_BATCH - reclaimed) },
    );
    const nextCursor = raw?.nextId;
    const messages = raw?.messages as Array<{
      id: string;
      message: Record<string, string>;
    } | null> | undefined;
    cursor = typeof nextCursor === 'string' ? nextCursor : '0-0';
    if (!messages || messages.length === 0) break;

    for (const claimed of messages) {
      if (!claimed) continue;
      const msg: StreamMessage = { id: claimed.id, message: claimed.message };
      await processApplierStreamMessage(client, ackRedis, msg, state);
      reclaimed += 1;
    }
    if (cursor === '0-0') break;
  }
  if (reclaimed > 0) {
    console.log(`[redis-config-applier] reclaimed ${reclaimed} stale pending message(s)`);
  }
  return reclaimed;
}

async function logApplierPendingMetric(client: RedisClientType): Promise<void> {
  try {
    const summary = await client.xPending(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP);
    let pending: number | null = null;
    if (summary && typeof summary === 'object') {
      const row = summary as { pending?: number; count?: number };
      if (typeof row.pending === 'number') pending = row.pending;
      else if (typeof row.count === 'number') pending = row.count;
    }
    if (pending !== null && pending > 0) {
      console.warn(
        `[redis-config-applier] pending=${pending} group=${APPLIER_GROUP} (will auto-reclaim when idle>=${APPLIER_PENDING_RECLAIM_MIN_IDLE_MS}ms)`,
      );
    }
  } catch (err) {
    console.warn('[redis-config-applier] xpending metric failed:', err);
  }
}

export async function startRedisConfigApplier(): Promise<void> {
  if (!APPLIER_ENABLED) {
    console.log('[redis-config-applier] disabled');
    return;
  }
  if (!isRedisConfigured()) {
    console.log('[redis-config-applier] REDIS_HOST missing, applier disabled');
    return;
  }

  const client = await connectRedisClient(createRedisClient('redis-config-applier'));

  try {
    await client.xGroupCreate(REDIS_CONFIG_STREAM_KEY, APPLIER_GROUP, '$', { MKSTREAM: true });
    console.log(`[redis-config-applier] consumer group created: ${APPLIER_GROUP}`);
  } catch {
    // group already exists
  }

  console.log(
    `[redis-config-applier] listening stream=${REDIS_CONFIG_STREAM_KEY} group=${APPLIER_GROUP} consumer=${APPLIER_CONSUMER} instance=${AC_INSTANCE_ID}`,
  );

  await cleanupOrphanProcesses();

  const ackRedis: ConfigAckRedis = {
    incr: (key) => client.incr(key),
    ttl: (key) => client.ttl(key),
    expire: (key, seconds) => client.expire(key, seconds),
    del: (key) => client.del(key),
    setNx: async (key, value, ttlSec) => {
      const result = await client.set(key, value, { NX: true, EX: ttlSec });
      return result === 'OK';
    },
    xAdd: (key, id, message) => client.xAdd(key, id, message),
    xAck: (stream, group, id) => client.xAck(stream, group, id),
  };

  const state = { isFirstSnapshot: true };
  try {
    await logApplierPendingMetric(client);
    await reclaimStaleApplierPending(client, ackRedis, state);
  } catch (err) {
    console.error('[redis-config-applier] initial pending reclaim error:', err);
  }

  let lastReclaimAt = Date.now();
  while (true) {
    try {
      const now = Date.now();
      if (now - lastReclaimAt >= APPLIER_PENDING_RECLAIM_INTERVAL_MS) {
        lastReclaimAt = now;
        try {
          await logApplierPendingMetric(client);
          await reclaimStaleApplierPending(client, ackRedis, state);
        } catch (err) {
          console.error('[redis-config-applier] periodic pending reclaim error:', err);
        }
      }

      const raw = await client.xReadGroup(
        APPLIER_GROUP,
        APPLIER_CONSUMER,
        { key: REDIS_CONFIG_STREAM_KEY, id: '>' },
        { COUNT: 5, BLOCK: 5000 },
      );
      const results = (raw ?? null) as unknown as StreamReadResult | null;
      if (!results || results.length === 0) continue;

      for (const stream of results) {
        for (const msg of stream.messages) {
          await processApplierStreamMessage(client, ackRedis, msg, state);
        }
      }
    } catch (err) {
      console.error('[redis-config-applier] loop error:', err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
