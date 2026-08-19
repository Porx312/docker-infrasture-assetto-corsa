import { isHudConvexConfigured } from './hudConvex.js';
import { getSessionCached } from './lapCompletedHudRefresh.js';
import {
  refreshPlayerJoinFromConvex,
  type ApplyPlayerJoinContextOptions,
} from './playerJoinContext.js';
import {
  countHudPushListeners,
  pushHudUpdateForSteamId,
  type HudPushReason,
} from './hudPushHub.js';

export type RefreshHudUserStatusOptions = ApplyPlayerJoinContextOptions & {
  reason?: string;
};

const LIVE_SESSION_PUSH_REASONS = new Set(['cosmetics', 'lap_pb', 'rival_pb', 'session']);

function pushReasonForWorkerReason(reason: string): HudPushReason | undefined {
  if (reason === 'lap_pb' || reason === 'rival_pb') {
    return reason;
  }
  if (reason === 'cosmetics') {
    return 'worker_cosmetics';
  }
  if (reason === 'session') {
    return 'join_initial';
  }
  return undefined;
}

/** Fetch Convex join context (ban + session cache), then push SSE to connected HUD clients. */
export async function refreshHudUserStatusFromConvex(
  steamId: string,
  options?: RefreshHudUserStatusOptions,
): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return;
  }

  if (!isHudConvexConfigured()) {
    await pushHudUpdateForSteamId(trimmed, false);
    return;
  }

  const reason = options?.reason?.trim() ?? '';
  const reasonSuffix = reason !== '' ? ` reason=${reason}` : '';

  if (LIVE_SESSION_PUSH_REASONS.has(reason)) {
    console.log(`[hud-user-status] live session refresh for steamId=${trimmed}${reasonSuffix}`);
  }

  try {
    await refreshPlayerJoinFromConvex(trimmed, {
      publishEnforcement: options?.publishEnforcement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[hud-user-status] Convex refresh failed for steamId=${trimmed}${reasonSuffix}: ${message}`,
    );
    throw error;
  }

  const pushReason = reason !== '' ? pushReasonForWorkerReason(reason) : 'join_initial';
  const pushOptions = pushReason !== undefined ? { pushReason } : undefined;

  // Cosmetics: join context can lag dedicated getHudSession — always bypass cache.
  if (reason === 'cosmetics') {
    await pushHudUpdateForSteamId(trimmed, true, pushOptions);
    if (LIVE_SESSION_PUSH_REASONS.has(reason)) {
      console.log(
        `[hud-worker] refresh-user done steamId=${trimmed}${reasonSuffix} joinContext=1 fetchSession=1 wsListeners=${countHudPushListeners(trimmed)}`,
      );
    }
    return;
  }

  // Join + lap/rival/session webhooks: getPlayerJoinContext already wrote ac:hud:session.
  // Prefer cache; pushHudUpdateForSteamId still fetches getHudSession when version mismatches.
  const cached = await getSessionCached({ steamId: trimmed });
  let fetchSession = 0;
  if (cached.ok && cached.profile) {
    await pushHudUpdateForSteamId(trimmed, false, {
      preferCachedSession: true,
      ...pushOptions,
    });
  } else {
    fetchSession = 1;
    await pushHudUpdateForSteamId(trimmed, true, pushOptions);
  }

  if (LIVE_SESSION_PUSH_REASONS.has(reason)) {
    console.log(
      `[hud-worker] refresh-user done steamId=${trimmed}${reasonSuffix} joinContext=1 fetchSession=${fetchSession} wsListeners=${countHudPushListeners(trimmed)}`,
    );
  }
}
