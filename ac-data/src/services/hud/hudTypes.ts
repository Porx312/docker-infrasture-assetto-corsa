export type HudRival = {
  rank: number;
  name: string;
  tier: number;
  lap_ms: number;
  car_name: string;
  avatar_url?: string;
};

export type HudProfile = {
  name: string;
  rank: number;
  tier: number;
  best_lap_ms: number;
  car_name: string;
  car_id: string;
  avatar_url?: string;
  steam_id: string;
  rival: HudRival | null;
};

export type HudEntry = {
  rank: number;
  name: string;
  tier: number;
  lap_ms: number;
  car_name: string;
  car_id: string;
  avatar_url?: string;
  steam_id?: string;
};

export type HudFilter = {
  id: string;
  label: string;
};

export type HudTimeRow = {
  layout_id: string;
  layout_name: string;
  car_name: string;
  car_id: string;
  best_lap_ms: number;
  tier: number;
  scope: 'server' | 'global';
  track_name?: string;
};

export type HudTop10Ok = {
  ok: true;
  version: string;
  server_name: string;
  track_name: string;
  layout_id: string;
  layout_name: string;
  car_filter: string;
  filters: HudFilter[];
  entries: HudEntry[];
};

export type HudTop10Err = {
  ok: false;
  reason: 'server_not_found' | 'track_not_found' | 'car_not_found' | 'no_data';
};

export type HudTop10 = HudTop10Ok | HudTop10Err;

export type HudPlayerOk = {
  ok: true;
  profile: HudProfile | null;
  times_on_track: HudTimeRow[];
  global_times: HudTimeRow[];
};

export type HudPlayerErr = {
  ok: false;
  reason: 'server_not_found' | 'track_not_found' | 'user_not_found';
};

export type HudPlayerResult = HudPlayerOk | HudPlayerErr;

export type HudContext = {
  server_id: string;
  server_name: string;
  track_id: string;
  track_name: string;
  layout_id: string;
  layout_name: string;
  car_id: string;
  car_name: string;
  player_steam_id: string;
};

export type HudSessionOk = {
  ok: true;
  version: string;
  context: HudContext;
  leaderboard: {
    title: string;
    map: string;
    layout: string;
    filters: HudFilter[];
    entries: HudEntry[];
  };
  profile: HudProfile | null;
};

export type HudSessionErr = {
  ok: false;
  reason: 'server_not_found' | 'track_not_found' | 'car_not_found' | 'user_not_found';
};

export type HudSessionResult = HudSessionOk | HudSessionErr;

export type HudSnapshotVersionResult = {
  instanceId: string;
  serverCount: number;
  maxLapVerifiedAt: number;
  version: string;
};

export type HudWorkerSnapshot = {
  cacheKey: string;
  version: string;
  top10: HudTop10Ok;
};

export type LbCacheParams = {
  serverName: string;
  track: string;
  trackConfig?: string;
  car?: string;
};

export type PlayerCacheParams = {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig?: string;
  carModel?: string;
};

export type SessionQueryParams = {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig?: string;
  carFilter?: string;
  carModel?: string;
};
