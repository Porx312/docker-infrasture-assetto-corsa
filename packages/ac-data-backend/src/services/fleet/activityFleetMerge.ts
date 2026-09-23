import type { Request } from 'express';
import {
  isFleetModeEnabled,
  listFleetEdges,
  type FleetEdge,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type {
  ActivityFeedResult,
  ActivityItem,
  ActivityPlayerJoin,
  ActivitySummary,
  ActivityTimelineResult,
} from '../activity/activityTypes.js';
import { fetchEdgeJson } from './fleetEdgeAdminFetch.js';

function tagItem<T extends ActivityItem>(item: T, edge: FleetEdge): T & {
  fleetEdgeId: string;
  fleetLabel: string;
} {
  return {
    ...item,
    fleetEdgeId: edge.id,
    fleetLabel: edge.label,
  };
}

function tagPlayerJoin(
  player: ActivityPlayerJoin,
  edge: FleetEdge,
): ActivityPlayerJoin & { fleetEdgeId: string; fleetLabel: string } {
  return {
    ...player,
    fleetEdgeId: edge.id,
    fleetLabel: edge.label,
  };
}

function mergeSummaries(
  day: string,
  since: number,
  until: number,
  parts: ActivitySummary[],
): ActivitySummary {
  const playersMap = new Map<string, ActivityPlayerJoin & { fleetEdgeId?: string; fleetLabel?: string }>();
  let joins = 0;
  let laps = 0;
  let pbs = 0;
  let battles = 0;
  let errors = 0;

  for (const part of parts) {
    joins += part.joins;
    laps += part.laps;
    pbs += part.pbs;
    battles += part.battles;
    errors += part.errors;
    for (const player of part.players) {
      const key = `${(player as { fleetEdgeId?: string }).fleetEdgeId ?? ''}:${player.steamId}`;
      const existing = playersMap.get(key);
      if (!existing || player.firstJoinTs < existing.firstJoinTs) {
        playersMap.set(key, player);
      }
    }
  }

  const players = [...playersMap.values()].sort((a, b) => a.firstJoinTs - b.firstJoinTs);

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

function queryStringFromReq(req: Request): string {
  const url = new URL(req.originalUrl, 'http://local');
  url.searchParams.delete('fleetEdge');
  return `${url.pathname}${url.search}`;
}

export type FleetActivityPayload = {
  ok: boolean;
  fleetMode: true;
  warnings?: string[];
};

export async function fetchMergedActivityServers(req: Request): Promise<
  FleetActivityPayload & {
    servers: Array<{
      name: string;
      displayName?: string;
      wrapperPort?: number | null;
      fleetEdgeId: string;
      fleetLabel: string;
    }>;
  }
> {
  const edges = listFleetEdges();
  const warnings: string[] = [];
  const servers: Array<{
    name: string;
    displayName?: string;
    wrapperPort?: number | null;
    fleetEdgeId: string;
    fleetLabel: string;
  }> = [];

  const results = await Promise.all(
    edges.map(async (edge) => {
      const path = '/admin/activity/servers';
      const result = await fetchEdgeJson<{
        ok: boolean;
        servers?: Array<{ name: string; displayName?: string; wrapperPort?: number | null }>;
      }>(edge, path);
      return { edge, result };
    }),
  );

  for (const { edge, result } of results) {
    if (!result.ok || !result.data?.servers) {
      warnings.push(`${edge.label}: ${result.error ?? `HTTP ${result.status}`}`);
      continue;
    }
    for (const server of result.data.servers) {
      servers.push({
        ...server,
        fleetEdgeId: edge.id,
        fleetLabel: edge.label,
        displayName: server.displayName
          ? `${server.displayName} (${edge.label})`
          : `${server.name} (${edge.label})`,
      });
    }
  }

  return { ok: true, fleetMode: true, servers, warnings: warnings.length ? warnings : undefined };
}

export async function fetchMergedActivityFeed(
  req: Request,
): Promise<FleetActivityPayload & ActivityFeedResult> {
  const edges = listFleetEdges();
  const path = queryStringFromReq(req);
  const warnings: string[] = [];
  const limit =
    typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
  const pageLimit = Number.isFinite(limit) ? limit : 50;

  const parts = await Promise.all(
    edges.map(async (edge) => {
      const localPath = path.includes('?')
        ? `${path}&limit=${pageLimit}`
        : `${path}?limit=${pageLimit}`;
      const result = await fetchEdgeJson<ActivityFeedResult & { ok: boolean }>(edge, localPath);
      return { edge, result };
    }),
  );

  const items: Array<ActivityItem & { fleetEdgeId: string; fleetLabel: string }> = [];
  const summaries: ActivitySummary[] = [];

  for (const { edge, result } of parts) {
    if (!result.ok || !result.data) {
      warnings.push(`${edge.label}: ${result.error ?? `HTTP ${result.status}`}`);
      continue;
    }
    const data = result.data;
    if (data.summary) {
      summaries.push({
        ...data.summary,
        players: data.summary.players.map((p) => tagPlayerJoin(p, edge)),
      });
    }
    for (const item of data.items ?? []) {
      items.push(tagItem(item, edge));
    }
  }

  items.sort((a, b) => b.ts - a.ts);
  const page = items.slice(0, pageLimit);

  const summary =
    summaries.length > 0
      ? mergeSummaries(
          summaries[0]!.day,
          summaries[0]!.since,
          summaries[0]!.until,
          summaries,
        )
      : {
          day: '',
          since: 0,
          until: 0,
          joins: 0,
          playerCount: 0,
          players: [],
          laps: 0,
          pbs: 0,
          battles: 0,
          errors: 0,
        };

  return {
    ok: true,
    fleetMode: true,
    items: page,
    nextCursor: null,
    hasMore: items.length > pageLimit,
    summary,
    warnings: warnings.length ? warnings : undefined,
  };
}

export async function fetchMergedActivitySummary(
  req: Request,
): Promise<FleetActivityPayload & { summary: ActivitySummary }> {
  const feed = await fetchMergedActivityFeed(req);
  return {
    ok: true,
    fleetMode: true,
    summary: feed.summary,
    warnings: feed.warnings,
  };
}

export async function fetchMergedActivityTimeline(
  req: Request,
): Promise<FleetActivityPayload & ActivityTimelineResult> {
  const feed = await fetchMergedActivityFeed(req);
  return {
    ok: true,
    fleetMode: true,
    items: feed.items,
    nextCursor: feed.nextCursor,
    hasMore: feed.hasMore,
    warnings: feed.warnings,
  };
}

export function shouldUseFleetActivityMerge(): boolean {
  return isFleetModeEnabled();
}
