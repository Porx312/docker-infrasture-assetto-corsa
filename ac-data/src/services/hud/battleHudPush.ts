import { getBattleCachedFast } from './battleHudReader.js';
import type { BattleCacheParams } from './hudTypes.js';
import { parseBattleScopeKey } from './hudBattleRooms.js';
import { parsePlayerScopeKey } from './hudScopeKeys.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { pushHudUpdateForSteamId } from './hudPushHub.js';
import { startHudUpdatesSubscriber } from './hudUpdatesSubscriber.js';
import type { HudBattleErr, HudBattleOk } from './hudTypes.js';

export type BattleHudPushEvent = 'battle';

export type BattleHudRoomListener = (event: BattleHudPushEvent, payload: unknown) => void;

function battleClearDelayMs(): number {
  return Number(process.env.HUD_BATTLE_CLEAR_DELAY_SEC || 5) * 1000;
}

const roomListeners = new Map<string, Set<BattleHudRoomListener>>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();
type BattleSnapshotFetcher = (params: BattleCacheParams) => Promise<HudBattleOk | HudBattleErr>;

export function battleLiveEnrichEnabled(): boolean {
  return (process.env.HUD_BATTLE_ENRICH_LIVE ?? 'true').trim().toLowerCase() !== 'false';
}

let battleSnapshotFetcher: BattleSnapshotFetcher = (params) =>
  getBattleCachedFast(params, { enrich: battleLiveEnrichEnabled() });
let battleInitialSnapshotFetcher: BattleSnapshotFetcher = (params) =>
  getBattleCachedFast(params, { enrich: true });
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

function battlePushLogEnabled(): boolean {
  return (process.env.HUD_BATTLE_PUSH_LOG ?? 'false').trim().toLowerCase() === 'true';
}

function logBattlePush(room: string, payload: HudBattleOk | HudBattleErr): void {
  if (!battlePushLogEnabled()) {
    return;
  }
  const listeners = roomListeners.get(room)?.size ?? 0;
  const state = payload.ok ? payload.state : payload.reason;
  const version = payload.ok && payload.version ? payload.version : '-';
  const revision =
    payload.ok && payload.revision !== undefined && payload.revision !== null
      ? String(payload.revision)
      : '-';
  console.log(
    `[battle-push] room=${room} state=${state} version=${version} revision=${revision} listeners=${listeners}`,
  );
}

function emitToRoom(room: string, event: BattleHudPushEvent, payload: unknown): void {
  if (event === 'battle' && payload && typeof payload === 'object') {
    logBattlePush(room, payload as HudBattleOk | HudBattleErr);
  }
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
    void (async () => {
      clearTimers.delete(room);
      const params = parseBattleScopeKey(room);
      if (params) {
        const result = await battleSnapshotFetcher(params);
        if (result.ok && shouldScheduleClear(result)) {
          emitToRoom(room, 'battle', result);
          scheduleBattleClear(room);
          return;
        }
      }
      const payload: HudBattleErr = { ok: false, reason: 'no_battle' };
      emitToRoom(room, 'battle', payload);
    })();
  }, battleClearDelayMs());
  clearTimers.set(room, timer);
}

export function isHudSseEnabled(): boolean {
  return (process.env.HUD_SSE_ENABLED ?? 'false').trim().toLowerCase() === 'true';
}

export function isHudWsEnabled(): boolean {
  return (process.env.HUD_WS_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export function shouldStartHudPushHub(): boolean {
  return isHudRedisConfigured() && (isHudWsEnabled() || isHudSseEnabled());
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
    onBoardUpdate: (_update) => {
      // Board-only bumps do not push SSE; local player updates come from lap/battle/connect events.
    },
    onPlayerUpdate: (update) => {
      const parsed = parsePlayerScopeKey(update.scopeKey);
      if (parsed) {
        // Cache was just written by refreshPlayerHudCache; avoid duplicate Convex fetch.
        void pushHudUpdateForSteamId(parsed.cacheKey, false, {
          preferCachedSession: true,
        });
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
    emitToRoom(room, 'battle', result);
    if (shouldScheduleClear(result)) {
      scheduleBattleClear(room);
    } else {
      cancelClearTimer(room);
    }
    return;
  }

  emitToRoom(room, 'battle', result);
}

export async function sendInitialBattleSnapshot(
  room: string,
  listener: BattleHudRoomListener,
): Promise<void> {
  const params = parseBattleScopeKey(room);
  if (!params) {
    return;
  }

  const result = await battleInitialSnapshotFetcher(params);
  if (!result.ok) {
    return;
  }

  listener('battle', result);
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
  battleSnapshotFetcher = (params) => getBattleCachedFast(params, { enrich: battleLiveEnrichEnabled() });
  battleInitialSnapshotFetcher = (params) => getBattleCachedFast(params, { enrich: true });
  hubStarted = false;
}

/** Test hook: inject battle snapshot fetcher for live pushes. */
export function setBattleFetcherForTests(fetcher: BattleSnapshotFetcher): void {
  battleSnapshotFetcher = fetcher;
}

/** Test hook: inject battle snapshot fetcher for initial SSE connect. */
export function setBattleInitialFetcherForTests(fetcher: BattleSnapshotFetcher): void {
  battleInitialSnapshotFetcher = fetcher;
}
