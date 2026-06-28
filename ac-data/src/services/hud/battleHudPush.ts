import { getBattleCached } from './battleHudReader.js';
import { parseBattleScopeKey } from './hudBattleRooms.js';
import { parseBoardScopeKey, parsePlayerScopeKey } from './hudScopeKeys.js';
import { isHudRedisConfigured } from './hudRedis.js';
import {
  pushSessionToBoardRoom,
  pushSessionToPlayerRoom,
} from './sessionHudPush.js';
import { startHudUpdatesSubscriber } from './hudUpdatesSubscriber.js';
import type { HudBattleErr, HudBattleOk } from './hudTypes.js';

export type BattleHudPushEvent = 'battle:update' | 'battle:clear';

export type BattleHudRoomListener = (event: BattleHudPushEvent, payload: unknown) => void;

function battleClearDelayMs(): number {
  return Number(process.env.HUD_BATTLE_CLEAR_DELAY_SEC || 5) * 1000;
}

const roomListeners = new Map<string, Set<BattleHudRoomListener>>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();
let battleSnapshotFetcher: typeof getBattleCached = getBattleCached;
let hubStarted = false;

function shouldScheduleClear(snapshot: HudBattleOk): boolean {
  return snapshot.state === 'finished' || snapshot.state === 'cancelled';
}

function cancelClearTimer(room: string): void {
  const existing = clearTimers.get(room);
  if (existing) {
    clearTimeout(existing);
    clearTimers.delete(room);
  }
}

function emitToRoom(room: string, event: BattleHudPushEvent, payload: unknown): void {
  const listeners = roomListeners.get(room);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener(event, payload);
  }
}

function scheduleBattleClear(room: string): void {
  cancelClearTimer(room);
  const timer = setTimeout(() => {
    clearTimers.delete(room);
    const payload: HudBattleErr = { ok: false, reason: 'no_battle' };
    emitToRoom(room, 'battle:clear', payload);
  }, battleClearDelayMs());
  clearTimers.set(room, timer);
}

export function isHudSseEnabled(): boolean {
  return (process.env.HUD_SSE_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export function shouldStartHudPushHub(): boolean {
  return isHudRedisConfigured() && isHudSseEnabled();
}

export function initHudPushHub(): void {
  if (!shouldStartHudPushHub() || hubStarted) {
    return;
  }
  hubStarted = true;
  void startHudUpdatesSubscriber({
    onBattleUpdate: (update) => {
      void pushBattleToRoom(update.scopeKey);
    },
    onBoardUpdate: (update) => {
      const parsed = parseBoardScopeKey(update.scopeKey);
      if (parsed) {
        pushSessionToBoardRoom(update.scopeKey);
      }
    },
    onPlayerUpdate: (update) => {
      const parsed = parsePlayerScopeKey(update.scopeKey);
      if (parsed) {
        pushSessionToPlayerRoom(update.scopeKey);
      }
    },
  });
  console.log('[hud-push] hub started (battle + session)');
}

export function subscribeBattleHudRoom(room: string, listener: BattleHudRoomListener): void {
  let listeners = roomListeners.get(room);
  if (!listeners) {
    listeners = new Set();
    roomListeners.set(room, listeners);
  }
  listeners.add(listener);
}

export function unsubscribeBattleHudRoom(room: string, listener: BattleHudRoomListener): void {
  const listeners = roomListeners.get(room);
  if (!listeners) {
    return;
  }
  listeners.delete(listener);
  if (listeners.size === 0) {
    roomListeners.delete(room);
  }
}

export async function pushBattleToRoom(room: string): Promise<void> {
  const params = parseBattleScopeKey(room);
  if (!params) {
    return;
  }

  const result = await battleSnapshotFetcher(params);
  if (result.ok) {
    emitToRoom(room, 'battle:update', result);
    if (shouldScheduleClear(result)) {
      scheduleBattleClear(room);
    } else {
      cancelClearTimer(room);
    }
    return;
  }

  emitToRoom(room, 'battle:clear', result);
}

export async function sendInitialBattleSnapshot(
  room: string,
  listener: BattleHudRoomListener,
): Promise<void> {
  const params = parseBattleScopeKey(room);
  if (!params) {
    return;
  }

  const result = await battleSnapshotFetcher(params);
  if (!result.ok) {
    return;
  }

  listener('battle:update', result);
  if (shouldScheduleClear(result)) {
    scheduleBattleClear(room);
  }
}

/** Test hook: reset hub state. */
export function resetBattleHudPushForTests(): void {
  for (const timer of clearTimers.values()) {
    clearTimeout(timer);
  }
  clearTimers.clear();
  roomListeners.clear();
  battleSnapshotFetcher = getBattleCached;
  hubStarted = false;
}

/** Test hook: inject battle snapshot fetcher. */
export function setBattleFetcherForTests(fetcher: typeof getBattleCached): void {
  battleSnapshotFetcher = fetcher;
}
