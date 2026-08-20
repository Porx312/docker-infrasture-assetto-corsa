import { isHudConvexConfigured } from './hudConvex.js';
import {
  refreshPlayerJoinFromConvex,
  type ApplyPlayerJoinContextOptions,
} from './playerJoinContext.js';
import {
  countHudPushListeners,
  pushHudUpdateForSteamId,
  type HudPushReason,
} from './hudPushHub.js';
import { shouldFetchHudSession } from './hudSessionFetchPolicy.js';

export type RefreshHudUserStatusOptions = ApplyPlayerJoinContextOptions & {
  reason?: string;
};

const LIVE_SESSION_PUSH_REASONS = new Set([
  'cosmetics',
  'lap_pb',
  'rival_pb',
  'session',
  'battle_elo',
]);

function pushReasonForWorkerReason(reason: string): HudPushReason | undefined {
  if (reason === 'lap_pb' || reason === 'rival_pb') {
    return reason;
  }
  if (reason === 'battle_elo') {
    return 'battle_elo';
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

  if (countHudPushListeners(trimmed) === 0) {
    return;
  }

  const pushReason = reason !== '' ? pushReasonForWorkerReason(reason) : 'join_initial';
  const pushOptions = pushReason !== undefined ? { pushReason } : undefined;
  const fetchSession = shouldFetchHudSession(reason === 'cosmetics' ? 'worker_cosmetics' : reason);

  if (fetchSession) {
    await pushHudUpdateForSteamId(trimmed, true, pushOptions);
  } else {
    await pushHudUpdateForSteamId(trimmed, false, pushOptions);
  }

  if (LIVE_SESSION_PUSH_REASONS.has(reason)) {
    console.log(
      `[hud-worker] refresh-user done steamId=${trimmed}${reasonSuffix} joinContext=1 fetchSession=${fetchSession ? 1 : 0} wsListeners=${countHudPushListeners(trimmed)}`,
    );
  }
}
