import type { Request } from 'express';

import { normalizeHudServerName } from './hudQueryNormalize.js';

export const HUD_WS_PATH = '/hud/ws';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function readServerNameFromRequestQuery(query: Request['query']): string | null {
  const direct =
    requireQueryString(query.serverName) ?? requireQueryString(query.server_name);
  return direct ? normalizeHudServerName(direct) : null;
}

export function readServerNameFromUrl(url: URL): string | null {
  const direct =
    requireQueryString(url.searchParams.get('serverName')) ??
    requireQueryString(url.searchParams.get('server_name'));
  return direct ? normalizeHudServerName(direct) : null;
}
