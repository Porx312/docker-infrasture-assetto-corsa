import type { Request } from 'express';

import { HUD_WS_PATH } from '@projectd/ac-data-shared/services/hud/hudQueryParams.js';
import {
  lookupHudEdgeByServerName,
  resolveHudEdgePublicBaseUrl,
} from '@projectd/ac-data-shared/services/hud/hudEdgeRegistry.js';
import { readServerNameFromRequestQuery } from './hudGateway.js';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function httpsToWss(baseUrl: string): string {
  if (baseUrl.toLowerCase().startsWith('https://')) {
    return `wss://${baseUrl.slice(8)}`;
  }
  if (baseUrl.toLowerCase().startsWith('http://')) {
    return `ws://${baseUrl.slice(7)}`;
  }
  return baseUrl;
}

function hubPublicBaseUrl(req: Request): string {
  const fromEnv = (process.env.HUD_PUBLIC_BASE_URL || process.env.PUBLIC_API_BASE_URL || '').trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto =
    typeof protoHeader === 'string' && protoHeader.trim()
      ? protoHeader.split(',')[0]?.trim()
      : 'https';
  return trimTrailingSlash(`${proto}://${String(host)}`);
}

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export type HudBootstrapBody =
  | { ok: false; reason: string; serverName?: string }
  | {
      ok: true;
      serverName: string;
      instanceId: string | null;
      http: { snapshot: string };
      ws: { primary: string; fallback: string };
    };

export function buildHudBootstrapResponse(req: Request): HudBootstrapBody {
  const serverName = readServerNameFromRequestQuery(req.query);
  if (!serverName) {
    return { ok: false, reason: 'serverName required for HUD bootstrap' };
  }

  const edge = lookupHudEdgeByServerName(serverName);
  if (!edge) {
    return { ok: false, reason: 'edge_not_registered', serverName };
  }

  const steamId = requireQueryString(req.query.steamId) ?? '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const part of value) {
        params.append(key, String(part));
      }
    } else {
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  const publicEdge = resolveHudEdgePublicBaseUrl(serverName) ?? edge.baseUrl;
  const hubBase = hubPublicBaseUrl(req);

  const primary = `${httpsToWss(publicEdge)}${HUD_WS_PATH}${qs ? `?${qs}` : ''}`;
  const fallback = `${httpsToWss(hubBase)}${HUD_WS_PATH}${qs ? `?${qs}` : ''}`;

  return {
    ok: true,
    serverName,
    instanceId: edge.instanceId ?? null,
    http: {
      snapshot: `/hud/snapshot${qs ? `?${qs}` : ''}`,
    },
    ws: {
      primary,
      fallback,
    },
  };
}
