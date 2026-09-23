import '../../config/loadEnv.js';
import { isConvexConfigured } from '../convexClient.js';
import {
  hubFetchHudSession,
  hubFetchHudVersion,
  hubFetchPlayerJoinContext,
  hubFetchWorkerSyncVersion,
  isEdgeHubWorkerClientConfigured,
} from '@projectd/ac-data-shared/services/edgeHubWorkerClient.js';
import {
  DEFAULT_WORKER_SYNC,
  queryHudSession,
  queryHudVersion,
  queryPlayerJoinContext,
  queryWorkerSyncVersion,
} from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import {
  isHubWorkerMode,
  shouldEdgeUseDirectConvex,
} from '@projectd/ac-data-shared/services/hubWorkerUrl.js';
import { recordHudConvexQuery } from './hudConvexQueryStats.js';
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

async function runHudConvexQuery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | { ok: false; reason: 'convex_unreachable' }> {
  recordHudConvexQuery(label);
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-convex] ${label} failed: ${message}`, err);
    return { ok: false, reason: 'convex_unreachable' };
  }
}

export function isHudConvexConfigured(): boolean {
  if (isEdgeHubWorkerClientConfigured()) {
    return true;
  }
  return Boolean(CONVEX_WORKER_SECRET) && isConvexConfigured();
}

function useHubWorker(): boolean {
  return isHubWorkerMode() && !shouldEdgeUseDirectConvex() && isEdgeHubWorkerClientConfigured();
}

export async function fetchWorkerSyncVersion(): Promise<WorkerSyncVersionResult> {
  const result = await runHudConvexQuery('fetchWorkerSyncVersion', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchWorkerSyncVersion(AC_INSTANCE_ID)) as {
        ok?: boolean;
        sync?: WorkerSyncVersionResult;
      };
      return body.sync ?? DEFAULT_WORKER_SYNC;
    }
    return queryWorkerSyncVersion(AC_INSTANCE_ID);
  });

  if (!('ok' in result)) {
    return result;
  }

  return DEFAULT_WORKER_SYNC;
}

export async function fetchPlayerJoinContext(steamId: string): Promise<PlayerJoinContextResult> {
  const result = await runHudConvexQuery('fetchPlayerJoinContext', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchPlayerJoinContext(steamId)) as {
        ok?: boolean;
        result?: PlayerJoinContextResult;
      };
      return (body.result ?? body) as PlayerJoinContextResult;
    }
    return (await queryPlayerJoinContext(steamId)) as PlayerJoinContextResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as PlayerJoinContextResult;
}

export async function fetchHudSession(params: SessionQueryParams): Promise<HudSessionResult> {
  const result = await runHudConvexQuery('fetchHudSession', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchHudSession(params.steamId)) as {
        ok?: boolean;
        result?: HudSessionResult;
      };
      return (body.result ?? body) as HudSessionResult;
    }
    return (await queryHudSession(params.steamId)) as HudSessionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudSessionResult;
}

export async function fetchHudVersion(params: HudVersionQueryParams): Promise<HudVersionResult> {
  const result = await runHudConvexQuery('fetchHudVersion', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchHudVersion(params.steamId, params.now)) as {
        ok?: boolean;
        result?: HudVersionResult;
      };
      return (body.result ?? body) as HudVersionResult;
    }
    return (await queryHudVersion(params.steamId, params.now)) as HudVersionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudVersionResult;
}
