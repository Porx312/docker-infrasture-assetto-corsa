import '@projectd/ac-data-shared/config/loadEnv.js';
import { isConvexConfigured } from '@projectd/ac-data-shared/services/convexClient.js';
import {
  hubFetchHudSession,
  hubFetchHudVersion,
  hubFetchPlayerJoinContext,
  hubFetchWorkerSyncVersion,
  isEdgeHubWorkerClientConfigured,
} from '@projectd/ac-data-shared/services/edgeHubWorkerClient.js';
import { hudWorkerPresenceFromRecord } from '@projectd/ac-data-shared/services/hud/hudWorkerPresence.js';
import type { HudWorkerPresenceArgs } from '@projectd/ac-data-shared/services/hud/hudWorkerPresence.js';
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
import { readPlayerPresenceRecord } from './hudPlayerPresence.js';
import type {
  HudSessionResult,
  HudVersionQueryParams,
  HudVersionResult,
  PlayerJoinContextResult,
  SessionQueryParams,
  WorkerSyncVersionResult,
} from '@projectd/ac-data-shared/services/hud/hudTypes.js';

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

async function resolvePresenceArgs(steamId: string): Promise<HudWorkerPresenceArgs | undefined> {
  try {
    const record = await readPlayerPresenceRecord(steamId);
    if (!record) {
      return undefined;
    }
    return hudWorkerPresenceFromRecord(record);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[hud-convex] presence read failed steamId=${steamId.trim()}: ${message}`);
    return undefined;
  }
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
  const presence = await resolvePresenceArgs(steamId);
  const result = await runHudConvexQuery('fetchPlayerJoinContext', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchPlayerJoinContext(steamId, presence)) as {
        ok?: boolean;
        result?: PlayerJoinContextResult;
      };
      return (body.result ?? body) as PlayerJoinContextResult;
    }
    return (await queryPlayerJoinContext(steamId, presence)) as PlayerJoinContextResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  const typed = result as PlayerJoinContextResult;
  if (
    presence &&
    typed &&
    typeof typed === 'object' &&
    'session' in typed &&
    typed.session &&
    typeof typed.session === 'object' &&
    'ok' in typed.session &&
    typed.session.ok === false &&
    'reason' in typed.session &&
    typed.session.reason === 'player_not_connected'
  ) {
    recordHudConvexQuery('convex_session_ignores_presence');
    console.warn(
      `[hud-convex] convex_session_ignores_presence steamId=${steamId.trim()} serverName=${presence.serverName}`,
    );
  }

  return typed;
}

export async function fetchHudSession(params: SessionQueryParams): Promise<HudSessionResult> {
  const presence = await resolvePresenceArgs(params.steamId);
  const result = await runHudConvexQuery('fetchHudSession', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchHudSession(params.steamId, presence)) as {
        ok?: boolean;
        result?: HudSessionResult;
      };
      return (body.result ?? body) as HudSessionResult;
    }
    return (await queryHudSession(params.steamId, presence)) as HudSessionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudSessionResult;
}

export async function fetchHudVersion(params: HudVersionQueryParams): Promise<HudVersionResult> {
  const presence = await resolvePresenceArgs(params.steamId);
  const result = await runHudConvexQuery('fetchHudVersion', async () => {
    if (useHubWorker()) {
      const body = (await hubFetchHudVersion(params.steamId, params.now, presence)) as {
        ok?: boolean;
        result?: HudVersionResult;
      };
      return (body.result ?? body) as HudVersionResult;
    }
    return (await queryHudVersion(params.steamId, params.now, presence)) as HudVersionResult;
  });

  if ('ok' in result && result.ok === false && result.reason === 'convex_unreachable') {
    return result;
  }

  return result as HudVersionResult;
}
