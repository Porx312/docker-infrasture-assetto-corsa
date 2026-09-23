import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Request, Response } from 'express';
import WebSocket, { WebSocketServer } from 'ws';

import {
  HUD_WS_PATH,
  readServerNameFromRequestQuery,
  readServerNameFromUrl,
} from '@projectd/ac-data-shared/services/hud/hudQueryParams.js';
import { resolveHudEdgeBaseUrl } from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import { resolveHudEdgeForSteamId } from './hudPlayerRouting.js';

export { readServerNameFromRequestQuery, readServerNameFromUrl } from '@projectd/ac-data-shared/services/hud/hudQueryParams.js';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function gatewayMissingSteamId(res: Response): void {
  res.status(400).json({ ok: false, reason: 'steamId required for HUD gateway' });
}

function gatewayRoutingFailed(
  res: Response,
  routing: Extract<Awaited<ReturnType<typeof resolveHudEdgeForSteamId>>, { ok: false }>,
): void {
  const status =
    routing.reason === 'player_not_connected' || routing.reason === 'edge_not_registered'
      ? 404
      : 503;
  res.status(status).json({
    ok: false,
    reason: routing.reason,
    serverName: routing.serverName,
    instanceId: routing.instanceId,
  });
}

async function resolveHudGatewayEdge(
  req: Request,
  res: Response,
): Promise<
  | { ok: true; edgeBase: string; logServerName: string }
  | { ok: false; handled: true }
  | { ok: false; handled: false; reason: 'gateway_disabled' }
> {
  if ((process.env.HUD_GATEWAY_ENABLED || 'true').trim().toLowerCase() === 'false') {
    return { ok: false, handled: false, reason: 'gateway_disabled' };
  }

  const steamId = requireQueryString(req.query.steamId);
  const legacyServerName = readServerNameFromRequestQuery(req.query);

  if (steamId) {
    const routing = await resolveHudEdgeForSteamId(steamId, { legacyServerName });
    if (!routing.ok) {
      gatewayRoutingFailed(res, routing);
      return { ok: false, handled: true };
    }
    return {
      ok: true,
      edgeBase: routing.edge.baseUrl,
      logServerName: routing.presence.serverName,
    };
  }

  if (legacyServerName) {
    const edgeBase = resolveHudEdgeBaseUrl(legacyServerName);
    if (!edgeBase) {
      res.status(404).json({ ok: false, reason: 'edge_not_registered', serverName: legacyServerName });
      return { ok: false, handled: true };
    }
    return { ok: true, edgeBase, logServerName: legacyServerName };
  }

  gatewayMissingSteamId(res);
  return { ok: false, handled: true };
}

function buildProxyQueryString(req: Request): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const part of value) {
        qs.append(key, String(part));
      }
    } else {
      qs.set(key, String(value));
    }
  }
  return qs.toString();
}

export async function proxyHudPathIfGateway(
  req: Request,
  res: Response,
  upstreamPath: string,
  logLabel: string,
): Promise<boolean> {
  const edge = await resolveHudGatewayEdge(req, res);
  if (!edge.ok) {
    return edge.handled;
  }

  const qs = buildProxyQueryString(req);
  const target = `${edge.edgeBase}${upstreamPath}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {};
  if (typeof req.headers['x-api-key'] === 'string') {
    headers['x-api-key'] = req.headers['x-api-key'];
  }

  try {
    const upstream = await fetch(target, { headers });
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    res.status(upstream.status);
    res.send(await upstream.text());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[hud-gateway] ${logLabel} proxy failed serverName=${edge.logServerName}: ${message}`,
    );
    res.status(502).json({ ok: false, reason: 'edge_unreachable', serverName: edge.logServerName });
  }

  return true;
}

export async function proxyHudSnapshotIfGateway(req: Request, res: Response): Promise<boolean> {
  return proxyHudPathIfGateway(req, res, '/hud/snapshot', 'snapshot');
}

export async function proxyHudProfileCosmeticsFpIfGateway(
  req: Request,
  res: Response,
): Promise<boolean> {
  return proxyHudPathIfGateway(req, res, '/hud/profile-cosmetics-fp', 'profile-cosmetics-fp');
}

function httpsToWss(baseUrl: string): string {
  if (baseUrl.toLowerCase().startsWith('https://')) {
    return `wss://${baseUrl.slice(8)}`;
  }
  if (baseUrl.toLowerCase().startsWith('http://')) {
    return `ws://${baseUrl.slice(7)}`;
  }
  return baseUrl;
}

function rejectUpgrade(socket: Socket | import('stream').Duplex, statusCode: number, message: string): void {
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

function pipeSockets(client: WebSocket, upstream: WebSocket, steamId: string, serverName: string): void {
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });
  const closeBoth = () => {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    try {
      upstream.close();
    } catch {
      /* ignore */
    }
  };
  client.on('close', closeBoth);
  upstream.on('close', closeBoth);
  client.on('error', () => {
    console.error(`[hud-gateway-ws] client error steamId=${steamId} serverName=${serverName}`);
    closeBoth();
  });
  upstream.on('error', () => {
    console.error(`[hud-gateway-ws] upstream error steamId=${steamId} serverName=${serverName}`);
    closeBoth();
  });
}

export function attachHudGatewayWs(server: HttpServer): WebSocketServer | null {
  if ((process.env.HUD_GATEWAY_ENABLED || 'true').trim().toLowerCase() === 'false') {
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!request.url) {
      return;
    }
    let url: URL;
    try {
      const host = request.headers.host ?? 'localhost';
      url = new URL(request.url, `http://${host}`);
    } catch {
      return;
    }

    if (url.pathname !== HUD_WS_PATH) {
      return;
    }

    const steamId = requireQueryString(url.searchParams.get('steamId'));
    if (!steamId) {
      rejectUpgrade(socket, 400, 'steamId required for HUD gateway');
      return;
    }

    const legacyServerName = readServerNameFromUrl(url);

    void resolveHudEdgeForSteamId(steamId, { legacyServerName }).then((routing) => {
      if (!routing.ok) {
        const code = routing.reason === 'redis_unavailable' ? 503 : 404;
        rejectUpgrade(socket, code, routing.reason);
        return;
      }

      const edgeBase = routing.edge.baseUrl;
      const serverName = routing.presence.serverName;
      const upstreamUrl = `${httpsToWss(edgeBase)}${HUD_WS_PATH}?${url.searchParams.toString()}`;

      wss.handleUpgrade(request, socket, head, (clientWs) => {
        wss.emit('connection', clientWs, request);
        const upstream = new WebSocket(upstreamUrl, {
          headers:
            typeof request.headers['x-api-key'] === 'string'
              ? { 'x-api-key': request.headers['x-api-key'] }
              : {},
        });

        upstream.on('open', () => {
          console.log(
            `[hud-gateway-ws] proxy steamId=${steamId} serverName=${serverName} -> ${edgeBase}`,
          );
          pipeSockets(clientWs, upstream, steamId, serverName);
        });

        upstream.on('error', () => {
          if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
            clientWs.close(1011, 'edge_unreachable');
          }
        });
      });
    });
  });

  console.log('[hud-gateway-ws] enabled');
  return wss;
}
