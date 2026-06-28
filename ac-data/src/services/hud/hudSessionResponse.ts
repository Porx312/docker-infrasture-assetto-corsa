import type { HudSessionPlayer, HudSessionResult, HudSessionVpsResponse } from './hudTypes.js';

export function mapSessionResultToPlayer(steamId: string, result: HudSessionResult): HudSessionPlayer {
  if (!result.ok) {
    return mapMissingProfilePlayer(steamId);
  }

  return {
    steamId,
    ok: true,
    context: result.context,
    profile: result.profile,
  };
}

export function mapMissingProfilePlayer(steamId: string): HudSessionPlayer {
  return {
    steamId,
    ok: true,
    context: null,
    profile: null,
  };
}

export function buildSessionVpsResponse(
  version: string,
  players: HudSessionPlayer[],
): HudSessionVpsResponse {
  return {
    ok: true,
    version,
    players,
  };
}
