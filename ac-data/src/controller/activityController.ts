import type { Request, Response } from 'express';
import { getActivitySummary, getActivityTimeline } from '../services/activity/activityService.js';
import { isHudRedisConfigured } from '../services/hud/hudRedis.js';
import { summarizeServers } from '../services/serverBranding.js';
import type { ActivityCategory } from '../services/activity/activityTypes.js';

const VALID_CATEGORIES = new Set<string>([
  'all',
  'connections',
  'records',
  'battles',
  'errors',
  'sessions',
]);

function parseCategory(raw: unknown): ActivityCategory | 'all' | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = raw.trim().toLowerCase();
  if (!VALID_CATEGORIES.has(value)) return undefined;
  return value as ActivityCategory | 'all';
}

const DAY_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = raw.trim();
  if (!DAY_ISO_RE.test(value)) return undefined;
  return value;
}

export async function getActivityServersHandler(_req: Request, res: Response): Promise<void> {
  try {
    if (!isHudRedisConfigured()) {
      res.status(503).json({ ok: false, message: 'Redis not configured' });
      return;
    }

    const servers = summarizeServers().map((s) => ({
      name: s.name,
      displayName: s.displayName,
      wrapperPort: s.wrapperPort,
    }));

    res.json({ ok: true, servers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

function parseTzOffset(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) return undefined;
  if (value < -840 || value > 840) return undefined;
  return value;
}

export async function getActivitySummaryHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!isHudRedisConfigured()) {
      res.status(503).json({ ok: false, message: 'Redis not configured' });
      return;
    }

    const server = typeof req.query.server === 'string' ? req.query.server : undefined;
    const day = parseDay(req.query.day);
    const tzOffset = parseTzOffset(req.query.tzOffset);
    const summary = await getActivitySummary({ server, day, tzOffset });
    res.json({ ok: true, summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}

export async function getActivityTimelineHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!isHudRedisConfigured()) {
      res.status(503).json({ ok: false, message: 'Redis not configured' });
      return;
    }

    const server = typeof req.query.server === 'string' ? req.query.server : undefined;
    const category = parseCategory(req.query.category) ?? 'all';
    const day = parseDay(req.query.day);
    const tzOffset = parseTzOffset(req.query.tzOffset);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const timeline = await getActivityTimeline({
      server,
      category,
      day,
      tzOffset,
      q,
      cursor,
      limit,
    });

    res.json({ ok: true, ...timeline });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}
