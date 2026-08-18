import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import {
  initHudPushHub,
  isHudWsEnabled,
  unsubscribeBattleHudRoom,
  type BattleHudRoomListener,
} from './battleHudPush.js';
import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import {
  registerBattleSsePresence,
  resolvePlayerPresence,
  unregisterBattleSsePresence,
} from './hudPlayerPresence.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import {
  registerHudPushConnection,
  pushHudUpdateForSteamId,
  sendInitialHudPushSnapshot,
  type HudPushConnection,
} from './hudPushHub.js';
import { isHudRedisConfigured } from './hudRedis.js';
import {
  clearHudSsePresence,
  markHudSseConnected,
  renewHudSsePresence,
} from './hudSsePresence.js';
import { writeWsEvent } from './hudWsFormat.js';
import {
  refreshBattleRoomSubscription,
  type BattleRoomSubscription,
} from './hudStreamSseBattleRoom.js';
import { battleRoomFromParams } from './hudBattleRooms.js';

export const HUD_WS_PATH = '/hud/ws';

function wsKeepaliveMs(): number {
  return Number(process.env.HUD_WS_KEEPALIVE_MS || process.env.HUD_SSE_KEEPALIVE_MS || 30_000);
}

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function rejectUpgrade(socket: Socket, statusCode: number, message: string): void {
  const body = message;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

function parseUpgradeRequest(request: IncomingMessage): {
  ok: true;
  url: URL;
} | {
  ok: false;
  status: number;
  message: string;
} {
  if (!request.url) {
    return { ok: false, status: 400, message: 'Bad Request' };
  }

  const host = request.headers.host ?? 'localhost';
  let url: URL;
  try {
    url = new URL(request.url, `http://${host}`);
  } catch {
    return { ok: false, status: 400, message: 'Bad Request' };
  }

  if (url.pathname !== HUD_WS_PATH) {
    return { ok: false, status: 404, message: 'Not Found' };
  }

  return { ok: true, url };
}

function wsSendJson(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState !== ws.OPEN) {
    return;
  }
  writeWsEvent((payload) => {
    ws.send(payload);
  }, event, data);
}

async function handleHudWsConnection(ws: WebSocket, steamId: string, serverName: string): Promise<void> {
  const battleRoom = battleRoomFromParams(serverName, steamId);
  console.log(
    `[hud-ws-connect] steamId=${steamId} serverName=${serverName} room=${battleRoom}`,
  );

  registerBattleSsePresence({ steamId, serverName });
  await markHudSseConnected(steamId);
  initHudPushHub();

  const hudConn: HudPushConnection = {
    steamId,
    lastVersionFingerprint: null,
    send: (event, payload) => {
      wsSendJson(ws, event, payload);
    },
  };

  const unregisterHud = registerHudPushConnection(hudConn);

  const battleListener: BattleHudRoomListener = (event, payload) => {
    wsSendJson(ws, event, payload);
  };

  let battleSubscription: BattleRoomSubscription | null = {
    room: '',
    listener: battleListener,
  };
  battleSubscription = await refreshBattleRoomSubscription(steamId, battleSubscription);
  void sendInitialHudPushSnapshot(hudConn, serverName);

  const keepalive = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
    void renewHudSsePresence(steamId);
    void (async () => {
      const cached = await peekSessionCache({ steamId });
      if (cached && !cached.ok && cached.reason === 'player_not_connected') {
        await pushHudUpdateForSteamId(steamId, true);
      }
    })();
    void refreshBattleRoomSubscription(steamId, battleSubscription).then((next) => {
      battleSubscription = next;
    });
  }, wsKeepaliveMs());

  ws.on('error', (err) => {
    console.error(
      `[hud-ws-error] steamId=${steamId} message=${err instanceof Error ? err.message : String(err)}`,
    );
  });

  ws.on('close', (code, reason) => {
    clearInterval(keepalive);
    unregisterHud();
    unregisterBattleSsePresence(steamId);
    void clearHudSsePresence(steamId);
    if (battleSubscription) {
      unsubscribeBattleHudRoom(battleSubscription.room, battleSubscription.listener);
    }
    const reasonText = reason.toString('utf8') || '(none)';
    console.log(`[hud-ws-close] steamId=${steamId} code=${code} reason=${reasonText}`);
  });
}

export function attachHudWs(server: HttpServer): WebSocketServer | null {
  if (!isHudRedisConfigured() || !isHudWsEnabled()) {
    console.log('[hud-ws] disabled (set HUD_WS_ENABLED=true and configure Redis)');
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsed = parseUpgradeRequest(request);
    if (!parsed.ok) {
      if (parsed.status === 404) {
        return;
      }
      rejectUpgrade(socket, parsed.status, parsed.message);
      return;
    }

    const steamId = requireQueryString(parsed.url.searchParams.get('steamId'));
    if (!steamId) {
      rejectUpgrade(socket, 400, 'steamId is required');
      return;
    }

    const auth = requireHudApiKeyFromQuery(
      parsed.url.searchParams.get('api_key'),
      request.headers['x-api-key'],
    );
    if (!auth.ok) {
      rejectUpgrade(socket, auth.status, auth.body.error);
      return;
    }

    void (async () => {
      const resolved = await resolvePlayerPresence(steamId);
      if (!resolved.ok) {
        rejectUpgrade(socket, 404, resolved.reason);
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
        void handleHudWsConnection(ws, steamId, resolved.presence.serverName);
      });
    })().catch((err: unknown) => {
      console.error('[hud-ws] upgrade error:', err);
      rejectUpgrade(socket, 503, 'Service Unavailable');
    });
  });

  console.log(`[hud-ws] listening on ${HUD_WS_PATH} keepaliveMs=${wsKeepaliveMs()}`);
  return wss;
}

export { isHudWsEnabled } from './battleHudPush.js';
