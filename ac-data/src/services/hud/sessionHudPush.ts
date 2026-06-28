import {
  buildBoardCacheKey,
  buildPlayerCacheKey,
} from './hudCacheKeys.js';
import { isCarModelId } from './hudCarModel.js';
import {
  buildSessionVpsResponse,
  mapMissingProfilePlayer,
  mapSessionResultToPlayer,
} from './hudSessionResponse.js';
import { getPlayerCached, getSessionCached, invalidateSessionCache } from './lapCompletedHudRefresh.js';
import { mergeSessionProfileFields } from './hudProfile.js';
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
};

export type SessionHudConnection = {
  steamId: string;
  listener: SessionHudRoomListener;
};

const GLOBAL_SESSION_ERRORS = new Set<HudSessionErr['reason']>([
  'player_not_connected',
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

function boardParamsFromSession(
  presenceLocation: ReturnType<typeof presenceToLocation>,
  session: { ok: true; context?: { server_name?: string; track_id?: string; layout_id?: string; car_id?: string } } | null,
) {
  const ctx = session?.ok ? session.context : undefined;
  return {
    serverName: ctx?.server_name ?? presenceLocation.serverName,
    track: ctx?.track_id ?? presenceLocation.track,
    trackConfig: ctx?.layout_id ?? presenceLocation.trackConfig,
    carId: ctx?.car_id,
  };
}

export async function buildSessionUpdatePayload(
  steamId: string,
  options: { invalidate?: boolean } = {},
): Promise<HudSessionVpsResponse | HudSessionVpsErr> {
  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const location = presenceToLocation(resolved.presence);
  const sessionParams = { steamId };

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

  let profile = session.ok ? session.profile : null;
  if (session.ok) {
    const playerResult = await getPlayerCached({ steamId });
    profile = mergeSessionProfileFields(session.profile, playerResult.ok ? playerResult.profile : null);
  }

  const player =
    session.ok && session.context
      ? {
          steamId,
          ok: true as const,
          context: session.context,
          profile,
        }
      : session.ok
        ? mapSessionResultToPlayer(steamId, { ...session, profile })
        : mapMissingProfilePlayer(steamId);

  const boardLocation = boardParamsFromSession(location, session.ok ? session : null);
  const boardCar =
    boardLocation.carId && isCarModelId(boardLocation.carId) ? boardLocation.carId : 'global';
  const boardVersion = await readBoardVersion({
    serverName: boardLocation.serverName,
    track: boardLocation.track,
    trackConfig: boardLocation.trackConfig,
    car: boardCar,
  });
  const playerVersion = await readPlayerVersion({ steamId });
  const version = combineSessionVersion(boardVersion, [playerVersion]);

  return buildSessionVpsResponse(version, [player]);
}

async function pushSessionUpdateForConnection(
  conn: SessionHudConnection,
  invalidate = false,
): Promise<void> {
  const payload = await buildSessionUpdatePayload(conn.steamId, { invalidate });

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
    listener,
  };
  await pushSessionUpdateForConnection(conn, false);
}

export function subscribeSessionHudRooms(
  params: SessionHudSubscribeParams,
  listener: SessionHudRoomListener,
): () => void {
  const trackConfig = params.trackConfig ?? '';
  const conn: SessionHudConnection = {
    steamId: params.steamId,
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
  const carModel = params.carModel?.trim();
  if (carModel && isCarModelId(carModel)) {
    boardRooms.push(
      boardRoomFromCacheKey(
        buildBoardCacheKey({
          serverName: params.serverName,
          track: params.track,
          trackConfig,
          car: carModel,
        }),
      ),
    );
  }

  const playerRoom = playerRoomFromCacheKey(
    buildPlayerCacheKey({ steamId: params.steamId }),
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
