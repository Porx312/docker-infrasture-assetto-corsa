import { isHudConvexConfigured } from './hudConvex.js';
import { getSessionCached } from './lapCompletedHudRefresh.js';
import {
  refreshPlayerJoinFromConvex,
  type ApplyPlayerJoinContextOptions,
} from './playerJoinContext.js';
import { countHudSseListeners, pushHudUpdateForSteamId } from './hudSsePush.js';

export type RefreshHudUserStatusOptions = ApplyPlayerJoinContextOptions & {
  reason?: string;
};

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

  const reasonSuffix = options?.reason ? ` reason=${options.reason}` : '';
  if (options?.reason === 'cosmetics') {
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

  if (options?.reason === 'cosmetics') {
    // Live getHudSession — join context cache may lag behind dedicated session query.
    await pushHudUpdateForSteamId(trimmed, true);
    console.log(
      `[hud-user-status] cosmetics push done steamId=${trimmed} sseListeners=${countHudSseListeners(trimmed)}`,
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
