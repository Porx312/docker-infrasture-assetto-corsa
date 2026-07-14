import { isHudConvexConfigured } from './hudConvex.js';
import { refreshPlayerJoinFromConvex } from './playerJoinContext.js';
import { pushHudUpdateForSteamId } from './hudSsePush.js';

/** Fetch Convex join context (ban + session cache), then push SSE to connected HUD clients. */
export async function refreshHudUserStatusFromConvex(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return;
  }

  if (!isHudConvexConfigured()) {
    await pushHudUpdateForSteamId(trimmed, false);
    return;
  }

  try {
    await refreshPlayerJoinFromConvex(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[hud-user-status] Convex refresh failed for steamId=${trimmed}: ${message}`,
    );
  }

  await pushHudUpdateForSteamId(trimmed, false, { preferCachedSession: true });
}
