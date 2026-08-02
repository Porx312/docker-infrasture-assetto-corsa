import crypto from 'node:crypto';
import '../../config/loadEnv.js';
import { getHudRedisClient, isHudRedisConfigured } from '../hud/hudRedis.js';
import {
  buildJoinNameIndex,
  categoryForSummary,
  matchesCategory,
  matchesSearch,
  matchesServer,
  normalizeSessionEntries,
  normalizeStreamEntry,
  shouldSkipRawEvent,
  upsertUniquePlayerJoin,
} from './activityNormalize.js';
import type {
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

/** Scan stream for player_join events in [since, until) to enrich leave titles. */
async function fetchJoinNameIndex(since: number, until: number): Promise<Map<string, string>> {
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
      if (entry.event === 'player_join') {
        joinEntries.push(entry);
      }
    }

    if (stoppedEarly) break;
    if (batch.length < batchSize) break;
  }

  return buildJoinNameIndex(joinEntries);
}

export async function getActivityTimeline(
  query: ActivityTimelineQuery,
): Promise<ActivityTimelineResult> {
  if (!isHudRedisConfigured()) {
    throw new Error('Redis not configured');
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), ACTIVITY_TIMELINE_LIMIT);
  const category = query.category ?? 'all';
  const { since, until } = resolveDayBounds(query);
  const joinNames = await fetchJoinNameIndex(since, until);
  const items: ActivityItem[] = [];
  let cursor = query.cursor?.trim() || '';
  let hasMore = false;
  let rawFetched = 0;
  const sessionCounts = new Map<string, number>();

  while (items.length < limit && rawFetched < ACTIVITY_RAW_SCAN_MAX) {
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

      let item: ActivityItem | null = null;

      if (category === 'sessions') {
        if (entry.event !== 'server_status') continue;
        const data = entry.payload.data ?? {};
        const players = Array.isArray(data.players) ? data.players : [];
        const count = players.length;
        const key = entry.serverName.toLowerCase();
        const prev = sessionCounts.get(key);
        if (prev === count) continue;
        sessionCounts.set(key, count);
        const sessionItems = normalizeSessionEntries([entry]);
        item = sessionItems[0] ?? null;
      } else {
        if (entry.event === 'server_status') continue;
        if (shouldSkipRawEvent(entry.event)) continue;
        item = normalizeStreamEntry(entry, joinNames);
        if (item && !matchesCategory(item, category)) continue;
      }

      if (!item) continue;
      if (item.category !== 'errors' && !matchesServer(item, query.server)) continue;
      if (!matchesSearch(item, query.q)) continue;
      items.push(item);
      if (items.length >= limit) break;
    }

    if (stoppedEarly) break;
    if (batch.length < batchSize) break;
    if (items.length >= limit) {
      hasMore = true;
      break;
    }
  }

  const nextCursor = items.length > 0 ? items[items.length - 1]!.id : cursor || null;

  return {
    items,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };
}

export async function getActivitySummary(query: ActivitySummaryQuery): Promise<ActivitySummary> {
  if (!isHudRedisConfigured()) {
    throw new Error('Redis not configured');
  }

  const { day, since, until } = resolveDayBounds(query);
  let joins = 0;
  let laps = 0;
  let pbs = 0;
  let battles = 0;
  let errors = 0;
  const playersByKey = new Map<string, ActivityPlayerJoin>();

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

      if (entry.event === 'player_join') {
        const item = normalizeStreamEntry(entry);
        if (item && matchesServer(item, query.server)) {
          joins += 1;
          upsertUniquePlayerJoin(playersByKey, entry, entry.payload.data ?? {});
        }
        continue;
      }
      if (entry.event === 'lap_completed') {
        const item = normalizeStreamEntry(entry);
        if (item && matchesServer(item, query.server)) {
          laps += 1;
          if (item.kind === 'pb') pbs += 1;
        }
        continue;
      }
      if (entry.event === 'battle_finished') {
        const item = normalizeStreamEntry(entry);
        if (item && matchesServer(item, query.server)) battles += 1;
        continue;
      }
      if (entry.event === 'worker_error') {
        errors += 1;
      }
    }

    if (stoppedEarly) break;
    if (batch.length < batchSize) break;
  }

  const players = [...playersByKey.values()].sort((a, b) => b.firstJoinTs - a.firstJoinTs);

  return {
    day,
    since,
    until,
    joins,
    playerCount: players.length,
    players,
    laps,
    pbs,
    battles,
    errors,
  };
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
