import '../../config/loadEnv.js';
import { ensureConvexClient } from '../convexClient.js';
import { buildLbCacheKey } from './hudCacheKeys.js';
import type {
  HudPlayerResult,
  HudSessionResult,
  HudSnapshotVersionResult,
  HudTop10,
  HudTop10Ok,
  HudWorkerSnapshot,
  LbCacheParams,
  PlayerCacheParams,
  SessionQueryParams,
} from './hudTypes.js';

const CONVEX_WORKER_SECRET = process.env.CONVEX_WORKER_SECRET || '';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

const CONVEX_HUD_VERSION_QUERY =
  process.env.CONVEX_HUD_VERSION_QUERY || 'hud:getHudSnapshotVersion';
const CONVEX_HUD_SNAPSHOTS_QUERY =
  process.env.CONVEX_HUD_SNAPSHOTS_QUERY || 'hud:getHudSnapshotsForWorker';
const CONVEX_HUD_TOP10_QUERY = process.env.CONVEX_HUD_TOP10_QUERY || 'hud:getHudTop10';
const CONVEX_HUD_PLAYER_QUERY = process.env.CONVEX_HUD_PLAYER_QUERY || 'hud:getHudPlayer';
const CONVEX_HUD_SESSION_QUERY =
  process.env.CONVEX_HUD_SESSION_QUERY || 'hud:getHudSession';

export function isHudConvexConfigured(): boolean {
  return Boolean(CONVEX_WORKER_SECRET);
}

function workerArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workerSecret: CONVEX_WORKER_SECRET, ...extra };
}

export function resolveTop10CacheKey(
  params: LbCacheParams,
  top10: HudTop10Ok,
): string {
  return buildLbCacheKey({
    serverName: params.serverName,
    track: params.track,
    trackConfig: top10.layout_id,
    car: top10.car_filter,
  });
}

export async function fetchHudSnapshotVersion(): Promise<HudSnapshotVersionResult> {
  const { query } = ensureConvexClient();
  const raw = await query(CONVEX_HUD_VERSION_QUERY, workerArgs({ instanceId: AC_INSTANCE_ID }));
  return raw as HudSnapshotVersionResult;
}

export async function fetchHudSnapshotsForWorker(): Promise<HudWorkerSnapshot[]> {
  const { query } = ensureConvexClient();
  const raw = await query(CONVEX_HUD_SNAPSHOTS_QUERY, workerArgs({ instanceId: AC_INSTANCE_ID }));
  return (raw ?? []) as HudWorkerSnapshot[];
}

export async function queryHudTop10(params: LbCacheParams): Promise<HudTop10> {
  const { query } = ensureConvexClient();
  const args: Record<string, unknown> = {
    serverName: params.serverName,
    track: params.track,
  };
  if (params.trackConfig) {
    args.trackConfig = params.trackConfig;
  }
  if (params.car) {
    args.car = params.car;
  }

  const raw = await query(CONVEX_HUD_TOP10_QUERY, workerArgs(args));
  return raw as HudTop10;
}

export async function fetchHudTop10(
  params: LbCacheParams,
): Promise<{ cacheKey: string; top10: HudTop10Ok }> {
  const result = await queryHudTop10(params);
  if (!result.ok) {
    throw new Error(`getHudTop10: ${result.reason}`);
  }

  return {
    cacheKey: resolveTop10CacheKey(params, result),
    top10: result,
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
