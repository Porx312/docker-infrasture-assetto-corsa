import type { Request } from 'express';

import { HUD_WS_PATH } from '@projectd/ac-data-shared/services/hud/hudQueryParams.js';
import { httpsToWss } from '@projectd/ac-data-shared/services/hud/hudWsUrl.js';
import {
  legacyServerNameFromQuery,
  resolveHudEdgeForSteamId,
} from './hudPlayerRouting.js';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
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
  | { ok: false; reason: string; serverName?: string; instanceId?: string }
  | {
      ok: true;
      serverName: string;
      folderSlug: string | null;
      instanceId: string | null;
      http: { snapshot: string };
      ws: { primary: string; fallback: string };
    };

export async function buildHudBootstrapResponse(req: Request): Promise<HudBootstrapBody> {
  const steamId = requireQueryString(req.query.steamId);
  if (!steamId) {
    return { ok: false, reason: 'steamId required for HUD bootstrap' };
  }

  const legacyServerName = legacyServerNameFromQuery(req.query as Record<string, unknown>);
  const routing = await resolveHudEdgeForSteamId(steamId, { legacyServerName });

  if (!routing.ok) {
    return {
      ok: false,
      reason: routing.reason,
      serverName: routing.serverName,
      instanceId: routing.instanceId,
    };
  }

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
  const hubBase = hubPublicBaseUrl(req);
  const publicEdge = routing.publicBaseUrl;

  const primary = `${httpsToWss(publicEdge)}${HUD_WS_PATH}${qs ? `?${qs}` : ''}`;
  const fallback = `${httpsToWss(hubBase)}${HUD_WS_PATH}${qs ? `?${qs}` : ''}`;

  return {
    ok: true,
    serverName: routing.presence.serverName,
    folderSlug: routing.presence.folderSlug ?? null,
    instanceId: routing.presence.instanceId ?? routing.edge.instanceId ?? null,
    http: {
      snapshot: `/hud/snapshot${qs ? `?${qs}` : ''}`,
    },
    ws: {
      primary,
      fallback,
    },
  };
}
