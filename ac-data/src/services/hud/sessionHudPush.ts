import {
  buildBoardCacheKey,
  buildPlayerCacheKey,
} from './hudCacheKeys.js';
import {
  buildSessionVpsResponse,
  mapMissingProfilePlayer,
  mapSessionResultToPlayer,
} from './hudSessionResponse.js';
import { getSessionCached, invalidateSessionCache } from './lapCompletedHudRefresh.js';
import { normalizeHudQuery } from './hudQueryNormalize.js';
import { resolvePlayerPresence } from './hudPlayerPresence.js';
import {
  boardRoomFromCacheKey,
  playerRoomFromCacheKey,
} from './hudScopeKeys.js';
import {
  combineSessionVersion,
  readBoardVersion,
  readPlayerVersion,
} from './hudVersion.js';
import type {
  HudPresenceErrReason,
  HudSessionErr,
  HudSessionVpsErr,
  HudSessionVpsResponse,
  ResolvedPlayerPresence,
} from './hudTypes.js';

export type SessionHudPushEvent = 'session:update' | 'session:error';

export type SessionHudRoomListener = (event: SessionHudPushEvent, payload: unknown) => void;

export type SessionHudSubscribeParams = {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig: string;
  carModel?: string;
  carFilter?: string;
};

export type SessionHudConnection = {
  steamId: string;
  carFilter: string;
  carModel?: string;
  listener: SessionHudRoomListener;
};

const GLOBAL_SESSION_ERRORS = new Set<HudSessionErr['reason']>([
  'server_not_found',
  'track_not_found',
  'car_not_found',
]);

const boardRoomConnections = new Map<string, Set<SessionHudConnection>>();
const playerRoomConnections = new Map<string, Set<SessionHudConnection>>();

function addConnection(room: string, map: Map<string, Set<SessionHudConnection>>, conn: SessionHudConnection): void {
  let listeners = map.get(room);
  if (!listeners) {
    listeners = new Set();
    map.set(room, listeners);
  }
  listeners.add(conn);
}

function removeConnection(room: string, map: Map<string, Set<SessionHudConnection>>, conn: SessionHudConnection): void {
  const listeners = map.get(room);
  if (!listeners) {
    return;
  }
  listeners.delete(conn);
  if (listeners.size === 0) {
    map.delete(room);
  }
}

function presenceToLocation(presence: ResolvedPlayerPresence) {
  return normalizeHudQuery(presence.serverName, presence.track, presence.trackConfig || undefined);
}

export async function buildSessionUpdatePayload(
  steamId: string,
  options: { carFilter?: string; carModel?: string; invalidate?: boolean } = {},
): Promise<HudSessionVpsResponse | HudSessionVpsErr> {
  const carFilter = options.carFilter ?? 'global';
  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const location = presenceToLocation(resolved.presence);
  const sessionParams = {
    steamId,
    serverName: location.serverName,
    track: location.track,
    trackConfig: location.trackConfig,
    carFilter,
    carModel: options.carModel ?? (resolved.presence.carModel || undefined),
  };

  if (options.invalidate) {
    await invalidateSessionCache(sessionParams);
  }

  const session = await getSessionCached(sessionParams);
  if (!session.ok && session.reason === 'user_invalidated') {
    return { ok: false, reason: 'user_invalidated' };
  }
  if (!session.ok && GLOBAL_SESSION_ERRORS.has(session.reason)) {
    return { ok: false, reason: session.reason };
  }

  const player = session.ok
    ? mapSessionResultToPlayer(steamId, session)
    : mapMissingProfilePlayer(steamId);

  const boardVersion = await readBoardVersion({
    serverName: location.serverName,
    track: location.track,
    trackConfig: location.trackConfig,
    car: carFilter,
  });
  const playerVersion = await readPlayerVersion({
    steamId,
    serverName: location.serverName,
    track: location.track,
    trackConfig: location.trackConfig,
    carModel: sessionParams.carModel,
  });
  const version = combineSessionVersion(boardVersion, [playerVersion]);

  return buildSessionVpsResponse(version, [player]);
}

async function pushSessionUpdateForConnection(
  conn: SessionHudConnection,
  invalidate = false,
): Promise<void> {
  const payload = await buildSessionUpdatePayload(conn.steamId, {
    carFilter: conn.carFilter,
    carModel: conn.carModel,
    invalidate,
  });

  if (!payload.ok) {
    conn.listener('session:error', payload);
    return;
  }

  conn.listener('session:update', payload);
}

function emitToRoomConnections(
  map: Map<string, Set<SessionHudConnection>>,
  room: string,
  invalidate: boolean,
): void {
  const listeners = map.get(room);
  if (!listeners) {
    return;
  }
  for (const conn of listeners) {
    void pushSessionUpdateForConnection(conn, invalidate);
  }
}

export async function sendInitialSessionSnapshot(
  params: SessionHudSubscribeParams,
  listener: SessionHudRoomListener,
): Promise<void> {
  const conn: SessionHudConnection = {
    steamId: params.steamId,
    carFilter: params.carFilter ?? 'global',
    carModel: params.carModel,
    listener,
  };
  await pushSessionUpdateForConnection(conn, false);
}

export function subscribeSessionHudRooms(
  params: SessionHudSubscribeParams,
  listener: SessionHudRoomListener,
): () => void {
  const carFilter = params.carFilter ?? 'global';
  const trackConfig = params.trackConfig ?? '';
  const conn: SessionHudConnection = {
    steamId: params.steamId,
    carFilter,
    carModel: params.carModel,
    listener,
  };

  const boardRooms = [
    boardRoomFromCacheKey(
      buildBoardCacheKey({
        serverName: params.serverName,
        track: params.track,
        trackConfig,
        car: 'global',
      }),
    ),
  ];
  if (params.carModel) {
    boardRooms.push(
      boardRoomFromCacheKey(
        buildBoardCacheKey({
          serverName: params.serverName,
          track: params.track,
          trackConfig,
          car: params.carModel,
        }),
      ),
    );
  }
  if (carFilter !== 'global') {
    boardRooms.push(
      boardRoomFromCacheKey(
        buildBoardCacheKey({
          serverName: params.serverName,
          track: params.track,
          trackConfig,
          car: carFilter,
        }),
      ),
    );
  }

  const playerRoom = playerRoomFromCacheKey(
    buildPlayerCacheKey({
      steamId: params.steamId,
      serverName: params.serverName,
      track: params.track,
      trackConfig,
      carModel: params.carModel ?? '',
    }),
  );

  const uniqueBoardRooms = [...new Set(boardRooms)];
  for (const room of uniqueBoardRooms) {
    addConnection(room, boardRoomConnections, conn);
  }
  addConnection(playerRoom, playerRoomConnections, conn);

  return () => {
    for (const room of uniqueBoardRooms) {
      removeConnection(room, boardRoomConnections, conn);
    }
    removeConnection(playerRoom, playerRoomConnections, conn);
  };
}

export function pushSessionToBoardRoom(room: string): void {
  emitToRoomConnections(boardRoomConnections, room, true);
}

export function pushSessionToPlayerRoom(room: string): void {
  emitToRoomConnections(playerRoomConnections, room, false);
}

/** Test helper: reset session push hub state. */
export function resetSessionHudPushForTests(): void {
  boardRoomConnections.clear();
  playerRoomConnections.clear();
}

/** Test helper: count active session SSE subscriptions. */
export function getSessionHudConnectionCountForTests(): number {
  let count = 0;
  for (const listeners of playerRoomConnections.values()) {
    count += listeners.size;
  }
  return count;
}

export type { HudPresenceErrReason };
