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
  } else if (reason === 'cosmetics') {
    console.log(`[hud-user-status] cosmetics refresh for steamId=${trimmed}${reasonSuffix}`);
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

  if (LIVE_SESSION_PUSH_REASONS.has(reason)) {
    const pushReason = pushReasonForWorkerReason(reason);
    await pushHudUpdateForSteamId(trimmed, true, pushReason ? { pushReason } : undefined);
    console.log(
      `[hud-user-status] push done steamId=${trimmed}${reasonSuffix} wsListeners=${countHudPushListeners(trimmed)}`,
    );
    return;
  }

  const cached = await getSessionCached({ steamId: trimmed });
  if (cached.ok && cached.profile) {
    await pushHudUpdateForSteamId(trimmed, false, {
      preferCachedSession: true,
      pushReason: 'join_initial',
    });
    return;
  }

  await pushHudUpdateForSteamId(trimmed, true, { pushReason: 'join_initial' });
}
