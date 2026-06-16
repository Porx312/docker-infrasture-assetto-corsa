import '../../config/loadEnv.js';
import { isConvexConfigured } from '../convexClient.js';
import { fetchHudSnapshotVersion, fetchHudSnapshotsForWorker, isHudConvexConfigured } from './hudConvex.js';
import { wasHudCacheRefreshedRecently } from './lapCompletedHudRefresh.js';
import { lbRedisKey } from './hudCacheKeys.js';
import { HUD_LB_TTL_SEC, hudRedisSet, isHudRedisConfigured } from './hudRedis.js';
import { bumpLbVersion } from './hudVersion.js';

const HUD_CACHE_SYNC_ENABLED =
  (process.env.HUD_CACHE_SYNC_ENABLED || 'true').trim().toLowerCase() === 'true';
const HUD_CACHE_SYNC_INTERVAL_MS = Number(process.env.HUD_CACHE_SYNC_INTERVAL_MS || 120_000);
const HUD_CACHE_SYNC_SKIP_AFTER_LAP_MS = Number(
  process.env.HUD_CACHE_SYNC_SKIP_AFTER_LAP_MS || 90_000,
);
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

let lastHudVersion = '';

async function syncHudSnapshotsOnce(): Promise<void> {
  if (wasHudCacheRefreshedRecently(HUD_CACHE_SYNC_SKIP_AFTER_LAP_MS)) {
    return;
  }

  const versionResult = await fetchHudSnapshotVersion();
  const version = versionResult.version;
  if (!version || version === lastHudVersion) {
    return;
  }

  const snapshots = await fetchHudSnapshotsForWorker();
  for (const snap of snapshots) {
    await hudRedisSet(lbRedisKey(snap.cacheKey), JSON.stringify(snap.top10), HUD_LB_TTL_SEC);
    const parts = snap.cacheKey.split('@');
    const track = parts[1];
    const trackConfig = parts[2] ?? '';
    const car = parts[3] ?? 'global';
    if (track) {
      await bumpLbVersion({
        serverName: snap.top10.server_name,
        track,
        trackConfig,
        car,
      });
    }
  }

  lastHudVersion = version;
  console.log(
    `[hud-cache-sync] published ${snapshots.length} keys version=${version} instance=${AC_INSTANCE_ID}`,
  );
}

export async function startHudCacheSync(): Promise<void> {
  if (!HUD_CACHE_SYNC_ENABLED) {
    console.log('[hud-cache-sync] disabled');
    return;
  }
  if (!isHudRedisConfigured()) {
    console.log('[hud-cache-sync] REDIS_HOST missing, disabled');
    return;
  }
  if (!isConvexConfigured() || !isHudConvexConfigured()) {
    console.log('[hud-cache-sync] missing convex env, disabled');
    return;
  }

  const loop = async () => {
    try {
      await syncHudSnapshotsOnce();
    } catch (err) {
      console.error('[hud-cache-sync] loop error:', err);
    }
  };

  console.log(
    `[hud-cache-sync] enabled instance=${AC_INSTANCE_ID} interval=${HUD_CACHE_SYNC_INTERVAL_MS}ms`,
  );
  await loop();
  setInterval(() => {
    void loop();
  }, HUD_CACHE_SYNC_INTERVAL_MS);
}
