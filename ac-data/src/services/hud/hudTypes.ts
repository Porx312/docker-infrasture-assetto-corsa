export type HudRival = {
  rank: number;
  name: string;
  tier: number;
  lap_ms: number;
  car_name: string;
  avatar_url?: string;
};

export type HudRivals = {
  above: HudRival | null;
  below: HudRival | null;
};

export type HudProfile = {
  name: string;
  /** Leaderboard position on the car-scoped board (distinct from tier). */
  rank: number;
  /** Combo tier vs global WR for track + layout + carModel. */
  tier: number;
  best_lap_ms: number;
  car_name: string;
  car_id: string;
  avatar_url?: string;
  steam_id: string;
  elo?: number;
  isInvalidated?: boolean;
  rivals: HudRivals;
  /** Added by ac-data on SSE (`rivals.above`); Convex does not send this field. */
  rival?: HudRival | null;
};

export type HudPlayerOk = {
  ok: true;
  profile: HudProfile | null;
};

export type HudPresenceErrReason =
  | 'player_not_connected'
  | 'not_managed_server';

export type HudPlayerErr = {
  ok: false;
  reason:
    | 'server_not_found'
    | 'track_not_found'
    | 'user_not_found'
    | 'user_invalidated'
    | HudPresenceErrReason;
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
  profile: HudProfile | null;
};

export type HudSessionErr = {
  ok: false;
  reason:
    | 'server_not_found'
    | 'track_not_found'
    | 'car_not_found'
    | 'user_not_found'
    | 'user_invalidated'
    | HudPresenceErrReason;
};

export type HudSessionResult = HudSessionOk | HudSessionErr;

/** One player slot in session:update SSE payload. */
export type HudSessionPlayer = {
  steamId: string;
  ok: true;
  context: HudContext | null;
  profile: HudProfile | null;
};

export type HudSessionVpsResponse = {
  ok: true;
  version: string;
  players: HudSessionPlayer[];
};

export type HudSessionVpsErr = {
  ok: false;
  reason: HudSessionErr['reason'];
};

export type BoardCacheParams = {
  serverName: string;
  track: string;
  trackConfig?: string;
  car?: string;
};

/** Convex resolves server/track/car from active session; worker passes steamId only. */
export type PlayerCacheParams = {
  steamId: string;
};

/** Same as PlayerCacheParams — Convex resolves session from live_players. */
export type SessionQueryParams = PlayerCacheParams;

export type WorkerSyncVersionResult = {
  configVersion: string;
  pollIntervalMs: number;
  pollJitterMs: number;
};

export type HudBattlePlayer = {
  steamId: string;
  name: string;
  tier: number;
  elo?: number;
  avatar_url?: string;
  car_id: string;
  car_name: string;
  score: number;
  role?: 'lead' | 'chase';
};

/** Raw player slot from Redis before profile enrichment (may use legacy `car`). */
export type HudBattlePlayerSnapshot = Omit<
  HudBattlePlayer,
  'tier' | 'car_id' | 'car_name'
> & {
  tier?: number;
  elo?: number;
  car_id?: string;
  car_name?: string;
  car?: string;
};

export type HudBattlePointLogEntry = {
  scorer?: string;
  reason: string;
  ts: number;
  label: string;
};

export type HudBattleLastEvent = {
  reason: string;
  label: string;
  scorerSteamId?: string;
  ts: number;
};

export type HudBattleOk = {
  ok: true;
  version: string;
  battleId: string | null;
  state:
    | 'pairing'
    | 'arming'
    | 'armed'
    | 'launching'
    | 'active'
    | 'finished'
    | 'cancelled'
    | 'none';
  armingCountdownSec?: number;
  serverName: string;
  track: string;
  trackConfig: string;
  player1: HudBattlePlayer;
  player2: HudBattlePlayer;
  lastEvent?: HudBattleLastEvent;
  pointsLog: HudBattlePointLogEntry[];
  gap3dM?: number;
  disappearGapM?: number;
  cancelReason?: string;
  endReason?: string;
  endLabel?: string;
  finishGapM?: number;
  positionFallback?: boolean;
  winnerSteamId?: string;
  status?: 'active' | 'finished' | 'draw' | 'cancelled';
};

/** Battle snapshot as written by telemetry-data (before profile enrichment). */
export type HudBattleSnapshotOk = Omit<HudBattleOk, 'player1' | 'player2'> & {
  player1: HudBattlePlayerSnapshot;
  player2: HudBattlePlayerSnapshot;
};

export type HudBattleErr = {
  ok: false;
  reason: 'no_battle';
};

export type HudBattleResult = HudBattleOk | HudBattleErr;

export type BattleCacheParams = {
  serverName: string;
  steamId: string;
};

export type PlayerPresenceRecord = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
  updatedAt: number;
};

export type ResolvedPlayerPresence = PlayerPresenceRecord & {
  steamId: string;
  serverType: string;
  folderSlug: string;
};

export type ResolvePlayerPresenceResult =
  | { ok: true; presence: ResolvedPlayerPresence }
  | { ok: false; reason: HudPresenceErrReason };

