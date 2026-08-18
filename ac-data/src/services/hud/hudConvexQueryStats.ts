import { listConnectedHudSteamIds } from './hudPushHub.js';

const queryCounts = new Map<string, number>();

let logInterval: ReturnType<typeof setInterval> | null = null;

/** Increment counter for a Convex HUD query label (fetchHudSession, fetchHudVersion, …). */
export function recordHudConvexQuery(label: string): void {
  queryCounts.set(label, (queryCounts.get(label) ?? 0) + 1);
}

export type HudConvexQueryStatsSnapshot = {
  queries: Record<string, number>;
  total: number;
  streamConnected: number;
  wsConnected: number;
  since: string;
};

const statsStartedAt = new Date().toISOString();

/** Snapshot of in-process Convex query counts (resets on ac-data restart). */
export function getHudConvexQueryStats(): HudConvexQueryStatsSnapshot {
  const queries = Object.fromEntries(queryCounts.entries());
  const total = [...queryCounts.values()].reduce((sum, n) => sum + n, 0);
  return {
    queries,
    total,
    streamConnected: listConnectedHudSteamIds().length,
    wsConnected: listConnectedHudSteamIds().length,
    since: statsStartedAt,
  };
}

/** Test helper: reset counters. */
export function resetHudConvexQueryStatsForTests(): void {
  queryCounts.clear();
}

/** Periodic log when HUD_CONVEX_QUERY_LOG_INTERVAL_MS > 0 (default off). */
export function startHudConvexQueryStatsLogging(): void {
  const intervalMs = Number(process.env.HUD_CONVEX_QUERY_LOG_INTERVAL_MS || 0);
  if (intervalMs <= 0 || logInterval) {
    return;
  }

  logInterval = setInterval(() => {
    const snapshot = getHudConvexQueryStats();
    if (snapshot.total === 0) {
      return;
    }
    console.log(
      `[hud-convex-stats] total=${snapshot.total} stream=${snapshot.streamConnected} ${JSON.stringify(snapshot.queries)}`,
    );
  }, intervalMs);

  logInterval.unref?.();
}
