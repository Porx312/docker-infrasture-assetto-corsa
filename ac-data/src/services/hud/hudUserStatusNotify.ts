import { isHudConvexConfigured } from './hudConvex.js';
import { getSessionCached } from './lapCompletedHudRefresh.js';
import {
  refreshPlayerJoinFromConvex,
  type ApplyPlayerJoinContextOptions,
} from './playerJoinContext.js';
import { pushHudUpdateForSteamId } from './hudSsePush.js';

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

  const cached = await getSessionCached({ steamId: trimmed });
  if (cached.ok && cached.profile) {
    await pushHudUpdateForSteamId(trimmed, false, { preferCachedSession: true });
    return;
  }

  await pushHudUpdateForSteamId(trimmed, true);
}
