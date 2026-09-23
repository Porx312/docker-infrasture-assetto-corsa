import crypto from 'node:crypto';
import '../../config/loadEnv.js';
import { getHudRedisClient, isHudRedisConfigured } from '../hud/hudRedis.js';
import {
  buildJoinNameIndex,
  categoryForSummary,
  matchesCategory,
  matchesPlayerJoin,
  matchesSearch,
  matchesServer,
  normalizeSessionEntries,
  normalizeStreamEntry,
  shouldSkipRawEvent,
  upsertUniquePlayerJoin,
} from './activityNormalize.js';
import type {
  ActivityFeedQuery,
  ActivityFeedResult,
  ActivityItem,
  ActivityPlayerJoin,
  ActivitySummary,
  ActivitySummaryQuery,
  ActivityTimelineQuery,
  ActivityTimelineResult,
  ParsedStreamEntry,
  RedisStreamEnvelope,
} from './activityTypes.js';

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'ac:events';
const ACTIVITY_TIMELINE_LIMIT = Number(process.env.ACTIVITY_TIMELINE_LIMIT || 150);
const ACTIVITY_RAW_SCAN_MAX = Number(process.env.ACTIVITY_RAW_SCAN_MAX || 150_000);
const ACTIVITY_FETCH_BATCH = Number(process.env.ACTIVITY_FETCH_BATCH || 200);
const ACTIVITY_CACHE_TTL_MS = Number(process.env.ACTIVITY_CACHE_TTL_MS || 6000);

const DAY_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar day bounds [since, until) for YYYY-MM-DD. */
export function dayBoundsUtc(day: string): { since: number; until: number } {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  const since = Date.UTC(year, month - 1, date);
  return { since, until: since + 86_400_000 };
}

/**
 * Local calendar day bounds for YYYY-MM-DD in a fixed offset from UTC.
 * tzOffsetMinutes: minutes east of UTC (negated JS getTimezoneOffset).
 */
export function dayBoundsLocal(
  day: string,
  tzOffsetMinutes: number,
): { since: number; until: number } {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  const since = Date.UTC(year, month - 1, date) - tzOffsetMinutes * 60_000;
  return { since, until: since + 86_400_000 };
}

export function todayUtcIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's YYYY-MM-DD in the browser/admin timezone (via tzOffset). */
export function localTodayIso(tzOffsetMinutes: number): string {
  const localMs = Date.now() + tzOffsetMinutes * 60_000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveDayBounds(query: {
  day?: string;
  tzOffset?: number;
}): { day: string; since: number; until: number } {
  const tzOffset = query.tzOffset ?? 0;
  const trimmed = query.day?.trim();
  const day =
    trimmed && DAY_ISO_RE.test(trimmed)
      ? trimmed
      : tzOffset !== 0
        ? localTodayIso(tzOffset)
        : todayUtcIso();
  const { since, until } =
    tzOffset !== 0 ? dayBoundsLocal(day, tzOffset) : dayBoundsUtc(day);
  return { day, since, until };
}

function parsePayload(raw: string | undefined): RedisStreamEnvelope {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RedisStreamEnvelope;
  } catch {
    return {};
  }
}

function parseStreamRow(streamId: string, fields: Record<string, string>): ParsedStreamEntry | null {
  const event = fields.event ?? '';
  if (!event) return null;

  const payload = parsePayload(fields.payload);
  const serverName = (fields.serverName ?? payload.serverName ?? '').trim();
  const tsRaw = fields.ts ?? String(payload.ts ?? '');
  const ts = Number.parseInt(tsRaw, 10);

  return {
    streamId,
    event,
    serverName,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    payload: {
      ...payload,
      event: payload.event ?? event,
      serverName: payload.serverName ?? serverName,
      ts: payload.ts ?? (Number.isFinite(ts) ? ts : undefined),
    },
  };
}

async function fetchStreamBatch(
  endId: string,
  count: number,
): Promise<ParsedStreamEntry[]> {
  const client = await getHudRedisClient();
  const end = endId ? `(${endId}` : '+';
  const raw = await client.xRevRange(REDIS_STREAM_KEY, end, '-', { COUNT: count });

  const entries: ParsedStreamEntry[] = [];
  for (const row of raw) {
    const message =
      typeof row.message === 'object' && row.message !== null
        ? (row.message as Record<string, string>)
        : {};
    const parsed = parseStreamRow(String(row.id), message);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

type SummaryAccumulators = {
  joins: number;
  laps: number;
  pbs: number;
  battles: number;
  errors: number;
  playersByKey: Map<string, ActivityPlayerJoin>;
  joinNames: Map<string, string>;
};

type DayContextCacheEntry = {
  expiresAt: number;
  summary: ActivitySummary;
  joinNames: Map<string, string>;
};

const dayContextCache = new Map<string, DayContextCacheEntry>();
const feedCache = new Map<string, { expiresAt: number; result: ActivityFeedResult }>();

function dayContextCacheKey(day: string, tzOffset: number, server?: string): string {
  return `${day}|${tzOffset}|${server ?? ''}`;
}

export function feedCacheKeyForTests(query: ActivityFeedQuery): string {
  return feedCacheKey(query);
}

function feedCacheKey(query: ActivityFeedQuery): string {
  return [
    query.day ?? '',
    query.tzOffset ?? 0,
    query.server ?? '',
    query.category ?? 'all',
    query.q ?? '',
    query.cursor ?? '',
    query.limit ?? 50,
  ].join('|');
}

function emptySummaryAccumulators(): SummaryAccumulators {
  return {
    joins: 0,
    laps: 0,
    pbs: 0,
    battles: 0,
    errors: 0,
    playersByKey: new Map(),
    joinNames: new Map(),
  };
}

function accumulateSummaryEntry(
  entry: ParsedStreamEntry,
  serverFilter: string | undefined,
  acc: SummaryAccumulators,
): void {
  if (entry.event === 'player_join') {
    const item = normalizeStreamEntry(entry);
    if (item && matchesServer(item, serverFilter)) {
      acc.joins += 1;
      upsertUniquePlayerJoin(acc.playersByKey, entry, entry.payload.data ?? {});
      const data = entry.payload.data ?? {};
      const sid = typeof data.steamId === 'string' ? data.steamId.trim() : '';
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '';
      if (sid && name && !sid.startsWith('unknown_')) {
        acc.joinNames.set(sid, name);
      }
    }
    return;
  }
  if (entry.event === 'lap_completed') {
    const item = normalizeStreamEntry(entry);
    if (item && matchesServer(item, serverFilter)) {
      acc.laps += 1;
      if (item.kind === 'pb') acc.pbs += 1;
    }
    return;
  }
  if (entry.event === 'battle_finished') {
    const item = normalizeStreamEntry(entry);
    if (item && matchesServer(item, serverFilter)) acc.battles += 1;
    return;
  }
  if (entry.event === 'worker_error') {
    acc.errors += 1;
  }
}

function buildSummaryFromAccumulators(
  day: string,
  since: number,
  until: number,
  acc: SummaryAccumulators,
): ActivitySummary {
  const players = [...acc.playersByKey.values()].sort((a, b) => b.firstJoinTs - a.firstJoinTs);
  return {
    day,
    since,
    until,
    joins: acc.joins,
    playerCount: players.length,
    players,
    laps: acc.laps,
    pbs: acc.pbs,
    battles: acc.battles,
    errors: acc.errors,
  };
}

function applySearchToSummary(
  summary: ActivitySummary,
  q: string | undefined,
  timelineEventCount?: number,
): ActivitySummary {
  if (!q?.trim()) return summary;
  const players = summary.players.filter((p) => matchesPlayerJoin(p, q));
  return {
    ...summary,
    players,
    playerCount: players.length,
    filtered: true,
    timelineEventCount,
  };
}

function tryNormalizeTimelineEntry(
  entry: ParsedStreamEntry,
  category: ActivityFeedQuery['category'],
  joinNames: Map<string, string>,
  sessionCounts: Map<string, number>,
  query: ActivityFeedQuery,
): ActivityItem | null {
  const cat = category ?? 'all';
  let item: ActivityItem | null = null;

  if (cat === 'sessions') {
    if (entry.event !== 'server_status') return null;
    const data = entry.payload.data ?? {};
    const players = Array.isArray(data.players) ? data.players : [];
    const count = players.length;
    const key = entry.serverName.toLowerCase();
    const prev = sessionCounts.get(key);
    if (prev === count) return null;
    sessionCounts.set(key, count);
    item = normalizeSessionEntries([entry])[0] ?? null;
  } else {
    if (entry.event === 'server_status') return null;
    if (shouldSkipRawEvent(entry.event)) return null;
    item = normalizeStreamEntry(entry, joinNames);
    if (item && !matchesCategory(item, cat)) return null;
  }

  if (!item) return null;
  if (item.category !== 'errors' && !matchesServer(item, query.server)) return null;
  if (!matchesSearch(item, query.q)) return null;
  return item;
}

/** Single Redis scan: day summary + join index + timeline page. */
export async function getActivityFeed(query: ActivityFeedQuery): Promise<ActivityFeedResult> {
  if (!isHudRedisConfigured()) {
    throw new Error('Redis not configured');
  }

  const cacheKey = feedCacheKey(query);
  const cachedFeed = feedCache.get(cacheKey);
  if (cachedFeed && cachedFeed.expiresAt > Date.now()) {
    return cachedFeed.result;
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), ACTIVITY_TIMELINE_LIMIT);
  const collectTimeline = limit > 0;
  const category = query.category ?? 'all';
  const { day, since, until } = resolveDayBounds(query);
  const tzOffset = query.tzOffset ?? 0;
  const ctxKey = dayContextCacheKey(day, tzOffset, query.server);

  let cachedCtx = dayContextCache.get(ctxKey);
  const needDayScan = !cachedCtx || cachedCtx.expiresAt <= Date.now();

  const acc = emptySummaryAccumulators();
  let joinNames = cachedCtx?.joinNames ?? acc.joinNames;

  const timelineCandidates: Array<{ entry: ParsedStreamEntry; item: ActivityItem }> = [];
  let cursor = query.cursor?.trim() || '';
  let hasMore = false;
  let rawFetched = 0;
  let dayScanComplete = !needDayScan;
  const sessionCounts = new Map<string, number>();

  while (rawFetched < ACTIVITY_RAW_SCAN_MAX) {
    if (dayScanComplete && (!collectTimeline || timelineCandidates.length >= limit)) {
      break;
    }

    const batchSize = Math.min(ACTIVITY_FETCH_BATCH, ACTIVITY_RAW_SCAN_MAX - rawFetched);
    const batch = await fetchStreamBatch(cursor, batchSize);
    if (batch.length === 0) break;

    rawFetched += batch.length;
    cursor = batch[batch.length - 1]?.streamId ?? cursor;

    let stoppedEarly = false;
    for (const entry of batch) {
      if (entry.ts >= until) continue;
      if (entry.ts < since) {
        stoppedEarly = true;
        dayScanComplete = true;
        break;
      }

      if (needDayScan) {
        accumulateSummaryEntry(entry, query.server, acc);
      }

      if (collectTimeline && timelineCandidates.length < limit) {
        const names = needDayScan ? acc.joinNames : joinNames;
        const item = tryNormalizeTimelineEntry(entry, category, names, sessionCounts, query);
        if (item) {
          timelineCandidates.push({ entry, item });
        }
      }
    }

    if (stoppedEarly) {
      dayScanComplete = true;
    }
    if (batch.length < batchSize) {
      dayScanComplete = true;
    }
    if (collectTimeline && timelineCandidates.length >= limit && dayScanComplete) {
      hasMore = true;
      break;
    }
    if (collectTimeline && timelineCandidates.length >= limit && !dayScanComplete) {
      hasMore = true;
      continue;
    }
    if (dayScanComplete && (!collectTimeline || timelineCandidates.length < limit)) {
      break;
    }
  }

  if (needDayScan) {
    const summaryForCache = buildSummaryFromAccumulators(day, since, until, acc);
    dayContextCache.set(ctxKey, {
      expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS,
      summary: summaryForCache,
      joinNames: new Map(acc.joinNames),
    });
    joinNames = acc.joinNames;
  }

  const cachedSummary = dayContextCache.get(ctxKey)!.summary;

  let items = timelineCandidates.map(({ entry, item }) => {
    if (item.kind === 'leave') {
      return normalizeStreamEntry(entry, joinNames) ?? item;
    }
    return item;
  });

  const summary = applySearchToSummary(
    cachedSummary,
    query.q,
    query.q?.trim() ? items.length : undefined,
  );

  const nextCursor = items.length > 0 ? items[items.length - 1]!.id : cursor || null;

  const result: ActivityFeedResult = {
    summary,
    items,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };

  feedCache.set(cacheKey, { expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS, result });
  return result;
}

export async function getActivityTimeline(
  query: ActivityTimelineQuery,
): Promise<ActivityTimelineResult> {
  const feed = await getActivityFeed(query);
  return {
    items: feed.items,
    nextCursor: feed.nextCursor,
    hasMore: feed.hasMore,
  };
}

export async function getActivitySummary(query: ActivitySummaryQuery): Promise<ActivitySummary> {
  const feed = await getActivityFeed({
    ...query,
    category: 'all',
    limit: 0,
    cursor: undefined,
    q: undefined,
  });
  return feed.summary;
}

/** @deprecated Use getActivityFeed — kept for tests. */
export async function scanDayJoinNamesForTests(since: number, until: number): Promise<Map<string, string>> {
  const joinEntries: ParsedStreamEntry[] = [];
  let cursor = '';
  let rawFetched = 0;

  while (rawFetched < ACTIVITY_RAW_SCAN_MAX) {
    const batchSize = Math.min(ACTIVITY_FETCH_BATCH, ACTIVITY_RAW_SCAN_MAX - rawFetched);
    const batch = await fetchStreamBatch(cursor, batchSize);
    if (batch.length === 0) break;

    rawFetched += batch.length;
    cursor = batch[batch.length - 1]?.streamId ?? cursor;

    let stoppedEarly = false;
    for (const entry of batch) {
      if (entry.ts >= until) continue;
      if (entry.ts < since) {
        stoppedEarly = true;
        break;
      }
      if (entry.event === 'player_join') joinEntries.push(entry);
    }

    if (stoppedEarly) break;
    if (batch.length < batchSize) break;
  }

  return buildJoinNameIndex(joinEntries);
}

export function clearActivityCachesForTests(): void {
  dayContextCache.clear();
  feedCache.clear();
}

/** Publish admin-visible worker error (does not affect Convex ack flow). */
export async function publishWorkerErrorEvent(details: {
  error: string;
  failed: number;
  eventTypes: string[];
}): Promise<void> {
  if (!isHudRedisConfigured()) return;

  const client = await getHudRedisClient();
  const eventId = crypto.randomUUID();
  const ts = Date.now();
  const envelope = {
    eventId,
    schemaVersion: '1',
    event: 'worker_error',
    serverName: 'worker',
    instanceId: process.env.AC_INSTANCE_ID || 'default',
    ts,
    data: {
      error: details.error,
      failed: details.failed,
      eventTypes: details.eventTypes,
    },
  };

  await client.xAdd(
    REDIS_STREAM_KEY,
    '*',
    {
      event: 'worker_error',
      eventId,
      schemaVersion: '1',
      instanceId: process.env.AC_INSTANCE_ID || 'default',
      serverName: 'worker',
      ts: String(ts),
      payload: JSON.stringify(envelope),
    },
    { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: Number(process.env.REDIS_STREAM_MAXLEN || 200_000) } },
  );
}

export { categoryForSummary, parseStreamRow };
