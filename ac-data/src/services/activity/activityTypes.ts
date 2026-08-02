export type ActivityCategory =
  | 'connections'
  | 'records'
  | 'battles'
  | 'errors'
  | 'sessions';

export type ActivityKind =
  | 'join'
  | 'leave'
  | 'lap'
  | 'pb'
  | 'battle'
  | 'error'
  | 'session';

export type ActivityItem = {
  id: string;
  ts: number;
  category: ActivityCategory;
  kind: ActivityKind;
  title: string;
  detail: string;
  serverName: string;
  searchText: string;
};

/** One row per unique player who joined during the selected day (deduped by steamId). */
export type ActivityPlayerJoin = {
  steamId: string;
  name: string;
  firstJoinTs: number;
  serverName: string;
  carModel: string;
};

export type ActivitySummary = {
  day: string;
  since: number;
  until: number;
  /** Total player_join events (includes reconnects). */
  joins: number;
  /** Unique players who joined that day. */
  playerCount: number;
  players: ActivityPlayerJoin[];
  laps: number;
  pbs: number;
  battles: number;
  errors: number;
  /** True when results are scoped by search query. */
  filtered?: boolean;
  /** Timeline items returned for the current feed page (when filtered). */
  timelineEventCount?: number;
};

export type ActivityTimelineResult = {
  items: ActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ActivityFeedQuery = ActivityTimelineQuery;

export type ActivityFeedResult = ActivityTimelineResult & {
  summary: ActivitySummary;
};

export type RedisStreamEnvelope = {
  eventId?: string;
  schemaVersion?: string;
  event?: string;
  serverName?: string;
  instanceId?: string;
  ts?: number;
  data?: Record<string, unknown>;
};

export type ParsedStreamEntry = {
  streamId: string;
  event: string;
  serverName: string;
  ts: number;
  payload: RedisStreamEnvelope;
};

export type ActivityTimelineQuery = {
  server?: string;
  category?: ActivityCategory | 'all';
  q?: string;
  cursor?: string;
  limit?: number;
  /** Calendar day in YYYY-MM-DD (local calendar day when tzOffset is set). */
  day?: string;
  /** Minutes east of UTC (negated JS getTimezoneOffset). */
  tzOffset?: number;
};

export type ActivitySummaryQuery = {
  server?: string;
  /** Calendar day in YYYY-MM-DD (local calendar day when tzOffset is set). */
  day?: string;
  /** Minutes east of UTC (negated JS getTimezoneOffset). */
  tzOffset?: number;
};
