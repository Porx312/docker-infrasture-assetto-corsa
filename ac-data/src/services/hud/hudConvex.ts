import '../../config/loadEnv.js';
import { ensureConvexClient } from '../convexClient.js';
import type {
  HudSessionResult,
  HudVersionQueryParams,
  HudVersionResult,
  PlayerJoinContextResult,
  SessionQueryParams,
  WorkerSyncVersionResult,
} from './hudTypes.js';

const CONVEX_WORKER_SECRET = (process.env.CONVEX_WORKER_SECRET || '').trim();
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
const CONVEX_PLAYER_JOIN_QUERY =
  process.env.CONVEX_PLAYER_JOIN_QUERY || 'workerPlayers:getPlayerJoinContext';
const CONVEX_HUD_SESSION_QUERY =
  process.env.CONVEX_HUD_SESSION_QUERY || 'hud:getHudSession';
const CONVEX_HUD_VERSION_QUERY =
  process.env.CONVEX_HUD_VERSION_QUERY || 'hud:getHudVersion';

const DEFAULT_WORKER_SYNC: WorkerSyncVersionResult = {
  configVersion: '',
  pollIntervalMs: 30_000,
  pollJitterMs: 0,
};

export function isHudConvexConfigured(): boolean {
  return Boolean(CONVEX_WORKER_SECRET);
}

function workerArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workerSecret: CONVEX_WORKER_SECRET, ...extra };
}

async function runHudConvexQuery<T>(label: string, fn: () => Promise<T>): Promise<T | { ok: false; reason: 'convex_unreachable' }> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-convex] ${label} failed: ${message}`, err);
    return { ok: false, reason: 'convex_unreachable' };
  }
}

export async function fetchWorkerSyncVersion(): Promise<WorkerSyncVersionResult> {
  const result = await runHudConvexQuery('fetchWorkerSyncVersion', async () => {
    const { query } = ensureConvexClient();
    const raw = await query(CONVEX_WORKER_SYNC_QUERY, workerArgs({ instanceId: AC_INSTANCE_ID }));
    const sync = raw as WorkerSyncVersionResult;
    return {
      configVersion: sync.configVersion ?? '',
      pollIntervalMs: sync.pollIntervalMs ?? 30_000,
      pollJitterMs: sync.pollJitterMs ?? 0,
    } satisfies WorkerSyncVersionResult;
  });

  if (!('ok' in result)) {
    return result;
  }

  return DEFAULT_WORKER_SYNC;
}

export async function fetchPlayerJoinContext(steamId: string): Promise<PlayerJoinContextResult> {
  const result = await runHudConvexQuery('fetchPlayerJoinContext', async () => {
    const { query } = ensureConvexClient();
    const raw = await query(
      CONVEX_PLAYER_JOIN_QUERY,
      workerArgs({ steamId: steamId.trim() }),
    );
    return raw as PlayerJoinContextResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as PlayerJoinContextResult;
}

export async function fetchHudSession(params: SessionQueryParams): Promise<HudSessionResult> {
  const result = await runHudConvexQuery('fetchHudSession', async () => {
    const { query } = ensureConvexClient();
    const raw = await query(
      CONVEX_HUD_SESSION_QUERY,
      workerArgs({ steamId: params.steamId }),
    );
    return raw as HudSessionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudSessionResult;
}

export async function fetchHudVersion(params: HudVersionQueryParams): Promise<HudVersionResult> {
  const result = await runHudConvexQuery('fetchHudVersion', async () => {
    const { query } = ensureConvexClient();
    const args: Record<string, unknown> = { steamId: params.steamId };
    if (params.now !== undefined) {
      args.now = params.now;
    }
    const raw = await query(CONVEX_HUD_VERSION_QUERY, workerArgs(args));
    return raw as HudVersionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudVersionResult;
}
