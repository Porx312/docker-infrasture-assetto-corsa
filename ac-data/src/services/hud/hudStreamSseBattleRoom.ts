import {
  sendInitialBattleSnapshot,
  subscribeBattleHudRoom,
  unsubscribeBattleHudRoom,
  type BattleHudRoomListener,
} from './battleHudPush.js';
import { battleRoomFromParams } from './hudBattleRooms.js';
import {
  registerBattleSsePresence,
  refreshPlayerPresence,
  resolvePlayerPresence,
} from './hudPlayerPresence.js';
import type { ResolvedPlayerPresence, ResolvePlayerPresenceResult } from './hudTypes.js';

export type BattleRoomSubscription = {
  room: string;
  listener: BattleHudRoomListener;
};

type PresenceResolver = (steamId: string) => Promise<ResolvePlayerPresenceResult>;

let presenceResolverOverride: PresenceResolver | null = null;
let refreshPresenceOverride: ((presence: ResolvedPlayerPresence) => Promise<void>) | null =
  null;

/** Test hook: skip Redis presence refresh. */
export function setBattleRoomRefreshPresenceForTests(
  refresher: ((presence: ResolvedPlayerPresence) => Promise<void>) | null,
): void {
  refreshPresenceOverride = refresher;
}

/** Test hook: inject presence resolver. */
export function setBattleRoomPresenceResolverForTests(
  resolver: PresenceResolver | null,
): void {
  presenceResolverOverride = resolver;
}

async function resolvePresence(steamId: string): Promise<ResolvePlayerPresenceResult> {
  if (presenceResolverOverride) {
    return presenceResolverOverride(steamId);
  }
  return resolvePlayerPresence(steamId);
}

/**
 * Re-resolve player presence and move the SSE battle room subscription when serverName changes.
 */
export async function refreshBattleRoomSubscription(
  steamId: string,
  current: BattleRoomSubscription | null,
): Promise<BattleRoomSubscription | null> {
  const resolved = await resolvePresence(steamId);
  if (!resolved.ok) {
    return current;
  }

  await (refreshPresenceOverride
    ? refreshPresenceOverride(resolved.presence)
    : refreshPlayerPresence(resolved.presence));
  registerBattleSsePresence(resolved.presence);

  const room = battleRoomFromParams(resolved.presence.serverName, steamId);
  const listener = current?.listener;
  if (!listener) {
    return current;
  }

  if (current.room === room) {
    return current;
  }

  if (current.room) {
    unsubscribeBattleHudRoom(current.room, listener);
  }

  const next: BattleRoomSubscription = { room, listener };
  subscribeBattleHudRoom(room, listener);
  await sendInitialBattleSnapshot(room, listener);
  return next;
}
