import '../../config/loadEnv.js';
import { ensureConvexClient } from '../convexClient.js';
import type {
  HudPlayerResult,
  HudSessionResult,
  PlayerCacheParams,
  SessionQueryParams,
  WorkerSyncVersionResult,
} from './hudTypes.js';

const CONVEX_WORKER_SECRET = process.env.CONVEX_WORKER_SECRET || '';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

const CONVEX_WORKER_SYNC_QUERY =
  process.env.CONVEX_WORKER_SYNC_QUERY || 'workerSync:getWorkerInstanceSyncVersion';
const CONVEX_HUD_PLAYER_QUERY = process.env.CONVEX_HUD_PLAYER_QUERY || 'hud:getHudPlayer';
const CONVEX_HUD_SESSION_QUERY =
  process.env.CONVEX_HUD_SESSION_QUERY || 'hud:getHudSession';

export function isHudConvexConfigured(): boolean {
  return Boolean(CONVEX_WORKER_SECRET);
}

function workerArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workerSecret: CONVEX_WORKER_SECRET, ...extra };
}

export async function fetchWorkerSyncVersion(): Promise<WorkerSyncVersionResult> {
  const { query } = ensureConvexClient();
  const raw = await query(CONVEX_WORKER_SYNC_QUERY, workerArgs({ instanceId: AC_INSTANCE_ID }));
  const result = raw as WorkerSyncVersionResult;
  return {
    configVersion: result.configVersion ?? '',
    pollIntervalMs: result.pollIntervalMs ?? 30_000,
    pollJitterMs: result.pollJitterMs ?? 0,
  };
}

export async function fetchHudPlayer(params: PlayerCacheParams): Promise<HudPlayerResult> {
  const { query } = ensureConvexClient();
  const args: Record<string, unknown> = {
    steamId: params.steamId,
    serverName: params.serverName,
    track: params.track,
  };
  if (params.trackConfig) {
    args.trackConfig = params.trackConfig;
  }
  if (params.carModel) {
    args.carModel = params.carModel;
  }

  const raw = await query(CONVEX_HUD_PLAYER_QUERY, workerArgs(args));
  return raw as HudPlayerResult;
}

export async function fetchHudSession(params: SessionQueryParams): Promise<HudSessionResult> {
  const { query } = ensureConvexClient();
  const args: Record<string, unknown> = {
    steamId: params.steamId,
    serverName: params.serverName,
    track: params.track,
  };
  if (params.trackConfig) {
    args.trackConfig = params.trackConfig;
  }
  if (params.carFilter) {
    args.carFilter = params.carFilter;
  }
  if (params.carModel) {
    args.carModel = params.carModel;
  }

  const raw = await query(CONVEX_HUD_SESSION_QUERY, workerArgs(args));
  return raw as HudSessionResult;
}
