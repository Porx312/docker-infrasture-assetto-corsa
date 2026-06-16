import {
  cachePlayerForLap,
  cacheTop10ForLap,
  noteHudCacheRefreshed,
} from './lapCompletedHudRefresh.js';
import { isHudConvexConfigured } from './hudConvex.js';
import { isHudRedisConfigured } from './hudRedis.js';

const HUD_LAP_REFRESH_DEBOUNCE_MS = Number(process.env.HUD_LAP_REFRESH_DEBOUNCE_MS || 1500);
const HUD_LAP_REFRESH_DELAY_MS = Number(process.env.HUD_LAP_REFRESH_DELAY_MS || 400);

type Top10RefreshKey = string;
type PlayerRefreshKey = string;

type Top10Job = {
  serverName: string;
  track: string;
  trackConfig: string;
  car: string;
};

type PlayerJob = {
  steamId: string;
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
};

function top10JobKey(job: Top10Job): Top10RefreshKey {
  return `${job.serverName}|${job.track}|${job.trackConfig}|${job.car}`;
}

function playerJobKey(job: PlayerJob): PlayerRefreshKey {
  return `${job.steamId}|${job.serverName}|${job.track}|${job.trackConfig}|${job.carModel}`;
}

const pendingTop10 = new Map<Top10RefreshKey, Top10Job>();
const pendingPlayers = new Map<PlayerRefreshKey, PlayerJob>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

export function scheduleHudRefreshAfterLap(payload: Record<string, unknown>): void {
  if (!isHudRedisConfigured() || !isHudConvexConfigured()) {
    return;
  }

  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const track = typeof data.trackName === 'string' ? data.trackName : '';
  const trackConfig = typeof data.trackConfig === 'string' ? data.trackConfig : '';
  const carModel = typeof data.carModel === 'string' ? data.carModel : '';
  const steamId = typeof data.steamId === 'string' ? data.steamId : '';

  if (!serverName || !track) {
    return;
  }

  pendingTop10.set(top10JobKey({ serverName, track, trackConfig, car: 'global' }), {
    serverName,
    track,
    trackConfig,
    car: 'global',
  });

  if (carModel) {
    pendingTop10.set(top10JobKey({ serverName, track, trackConfig, car: carModel }), {
      serverName,
      track,
      trackConfig,
      car: carModel,
    });
  }

  if (steamId) {
    pendingPlayers.set(
      playerJobKey({ steamId, serverName, track, trackConfig, carModel }),
      { steamId, serverName, track, trackConfig, carModel },
    );
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushHudRefreshQueue();
  }, HUD_LAP_REFRESH_DEBOUNCE_MS);
}

async function flushHudRefreshQueue(): Promise<void> {
  if (flushPromise) {
    return flushPromise;
  }

  flushPromise = (async () => {
    const top10Jobs = [...pendingTop10.values()];
    const playerJobs = [...pendingPlayers.values()];
    pendingTop10.clear();
    pendingPlayers.clear();

    if (top10Jobs.length === 0 && playerJobs.length === 0) {
      return;
    }

    if (HUD_LAP_REFRESH_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, HUD_LAP_REFRESH_DELAY_MS));
    }

    try {
      await Promise.all([
        ...top10Jobs.map((job) => cacheTop10ForLap(job)),
        ...playerJobs.map((job) => cachePlayerForLap(job)),
      ]);
      noteHudCacheRefreshed();
      console.log(
        `[hud-lap-refresh] refreshed top10=${top10Jobs.length} players=${playerJobs.length}`,
      );
    } catch (err) {
      console.error('[hud-lap-refresh] flush error:', err);
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

/** Test helper: reset scheduler state. */
export function resetHudRefreshSchedulerForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingTop10.clear();
  pendingPlayers.clear();
  flushPromise = null;
}
