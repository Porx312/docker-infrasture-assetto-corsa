import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

export function extractHudSteamId(req: Pick<Request, 'query'>): string | undefined {
  const steamId = req.query.steamId;
  if (typeof steamId === 'string' && steamId.trim()) {
    return steamId.trim();
  }

  const steamIds = req.query.steamIds;
  if (typeof steamIds === 'string' && steamIds.trim()) {
    const first = steamIds.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return undefined;
}

/**
 * Rate-limit bucket per steamId when present (NAT-safe for many HUD clients).
 * Falls back to client IP for /hud/top10 and other routes without steamId.
 */
export function buildHudRateLimitKey(req: Request): string {
  const steamId = extractHudSteamId(req);
  if (steamId) {
    return `steam:${steamId}`;
  }

  return ipKeyGenerator(req.ip ?? 'unknown');
}
