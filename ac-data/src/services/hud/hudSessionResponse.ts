import type {
  HudContext,
  HudLeaderboard,
  HudPlayerResult,
  HudProfile,
  HudSessionPlayer,
  HudSessionVpsResponse,
  HudTop10Ok,
} from './hudTypes.js';

export function top10ToLeaderboard(top10: HudTop10Ok): HudLeaderboard {
  return {
    title: 'Top 10',
    map: top10.track_name,
    layout: top10.layout_name,
    filters: top10.filters,
    entries: top10.entries,
  };
}

export function buildPlayerContext(
  top10: HudTop10Ok,
  steamId: string,
  trackId: string,
  carModel?: string,
  profile?: HudProfile | null,
): HudContext {
  const carId = profile?.car_id ?? carModel ?? top10.car_filter;
  const carName = profile?.car_name ?? carId;

  return {
    server_id: '',
    server_name: top10.server_name,
    track_id: trackId,
    track_name: top10.track_name,
    layout_id: top10.layout_id,
    layout_name: top10.layout_name,
    car_id: carId,
    car_name: carName,
    player_steam_id: steamId,
  };
}

export function mapPlayerResultToSessionPlayer(
  steamId: string,
  top10: HudTop10Ok,
  trackId: string,
  carModel: string | undefined,
  result: HudPlayerResult,
): HudSessionPlayer {
  if (!result.ok) {
    return mapMissingProfilePlayer(steamId);
  }

  return {
    steamId,
    ok: true,
    context: buildPlayerContext(top10, steamId, trackId, carModel, result.profile),
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
  top10: HudTop10Ok,
  players: HudSessionPlayer[],
): HudSessionVpsResponse {
  return {
    ok: true,
    version: top10.version,
    leaderboard: top10ToLeaderboard(top10),
    players,
  };
}
