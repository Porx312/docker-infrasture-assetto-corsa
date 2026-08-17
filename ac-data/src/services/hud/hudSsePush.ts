/** @deprecated Import from hudPushHub.js — re-exports for backward compatibility during migration. */
export {
  buildHudErrorEvent,
  buildHudSessionEvent,
  buildHudVersionEvent,
  countHudPushListeners,
  countHudSseListeners,
  listConnectedHudSteamIds,
  loadHudSessionForPush,
  loadHudSessionForSse,
  pushHudUpdateForSteamId,
  registerHudPushConnection,
  resetHudPushConnectionsForTests,
  resetHudSseConnectionsForTests,
  sendInitialHudPushSnapshot,
  sendInitialHudSseSnapshot,
  sessionContextServerName,
  setHudPushHubTestHooks,
  setHudSsePushTestHooks,
  shouldBypassSessionCacheForPresence,
  versionFingerprint,
  type HudPushConnection,
  type HudPushReason,
  type HudPushSend,
  type PushHudUpdateOptions,
} from './hudPushHub.js';

import type { HudPushConnection, HudPushSend } from './hudPushHub.js';
import { registerHudPushConnection } from './hudPushHub.js';

/** @deprecated use HudPushConnection with send() */
export type HudSseListener = HudPushSend;

/** @deprecated use HudPushConnection */
export type HudSseConnection = HudPushConnection;

/** @deprecated use registerHudPushConnection */
export function registerHudSseConnection(
  conn: HudPushConnection | { steamId: string; listener: HudPushSend; lastVersionFingerprint: string | null; lastSessionLeaderboardFingerprint?: string | null },
): () => void {
  if ('send' in conn && typeof conn.send === 'function') {
    return registerHudPushConnection(conn as HudPushConnection);
  }
  const legacy = conn as {
    steamId: string;
    listener: HudPushSend;
    lastVersionFingerprint: string | null;
    lastSessionLeaderboardFingerprint?: string | null;
  };
  return registerHudPushConnection({
    steamId: legacy.steamId,
    send: legacy.listener,
    lastVersionFingerprint: legacy.lastVersionFingerprint,
    lastSessionLeaderboardFingerprint: legacy.lastSessionLeaderboardFingerprint,
  });
}
