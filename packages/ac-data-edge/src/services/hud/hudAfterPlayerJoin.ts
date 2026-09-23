import { refreshHudUserStatusFromConvex } from './hudUserStatusNotify.js';

/** Unified Convex fetch on join (ban + HUD cache), then SSE push from cache. */
export async function refreshHudAfterPlayerJoin(steamId: string): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed || trimmed.startsWith('unknown_')) {
    return;
  }

  await refreshHudUserStatusFromConvex(trimmed, { publishEnforcement: false });
}
