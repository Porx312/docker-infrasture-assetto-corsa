import {
  battleRedisKey,
  buildBattleCacheKey,
} from './hudCacheKeys.js';
import { battleLiveEnrichEnabled } from './battleHudEnrichConfig.js';
import { getPlayerCached, peekSessionCache } from './lapCompletedHudRefresh.js';
import { isProfileInvalidated, mergeCosmeticFields, playerResultFromSession } from './hudProfile.js';
import { hudRedisGet } from './hudRedis.js';
import type {
  BattleCacheParams,
  HudBattleOk,
  HudBattlePlayer,
  HudBattlePlayerSnapshot,
  HudBattleResult,
  HudBattleSnapshotOk,
  HudProfile,
} from './hudTypes.js';

const BATTLE_PREP_STATES = new Set<HudBattleOk['state']>([
  'pairing',
  'arming',
  'armed',
  'launching',
]);

export function isBattlePrepState(state: HudBattleOk['state']): boolean {
  return BATTLE_PREP_STATES.has(state);
}

export function shouldPeekOnlyBattleEnrich(state: HudBattleOk['state']): boolean {
  if (!battleLiveEnrichEnabled()) {
    return true;
  }
  return isBattlePrepState(state);
}

function battleEnrichLogEnabled(): boolean {
  return (process.env.HUD_BATTLE_ENRICH_LOG ?? 'false').trim().toLowerCase() === 'true';
}

function logBattleEnrich(
  state: HudBattleOk['state'],
  steamId: string,
  source: 'peek' | 'cache' | 'convex' | 'snapshot',
  reason?: string,
): void {
  if (!battleEnrichLogEnabled()) {
    return;
  }
  const reasonPart = reason ? ` reason=${reason}` : '';
  console.log(`[battle-enrich] state=${state} steamId=${steamId} source=${source}${reasonPart}`);
}

function snapshotCarId(player: HudBattlePlayerSnapshot): string {
  return player.car_id ?? player.car ?? '';
}

function snapshotCosmeticSource(player: HudBattlePlayerSnapshot): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

export function normalizeBattlePlayerSnapshot(
  player: HudBattlePlayerSnapshot,
): HudBattlePlayer {
  const carId = snapshotCarId(player);
  const normalized: HudBattlePlayer = {
    steamId: player.steamId,
    name: player.name,
    tier: player.tier ?? 0,
    ...(player.elo !== undefined ? { elo: player.elo } : {}),
    car_id: carId,
    car_name: player.car_name ?? carId,
    score: player.score,
    ...(player.role ? { role: player.role } : {}),
    ...(player.aheadOnTrack !== undefined ? { aheadOnTrack: player.aheadOnTrack } : {}),
    ...(player.avatar_url ? { avatar_url: player.avatar_url } : {}),
  };
  return mergeCosmeticFields(normalized, snapshotCosmeticSource(player));
}

export function mapProfileToBattlePlayer(
  base: HudBattlePlayer,
  profile: HudProfile | null | undefined,
): HudBattlePlayer {
  if (!profile) {
    return base;
  }

  const carId = profile.car_id || base.car_id;
  const elo = profile.elo ?? base.elo;
  const merged: HudBattlePlayer = {
    steamId: base.steamId,
    name: profile.name || base.name,
    tier: profile.tier ?? base.tier,
    ...(elo !== undefined ? { elo } : {}),
    car_id: carId,
    car_name: profile.car_name || carId,
    score: base.score,
    ...(base.role ? { role: base.role } : {}),
    ...(base.aheadOnTrack !== undefined ? { aheadOnTrack: base.aheadOnTrack } : {}),
    ...(profile.avatar_url ? { avatar_url: profile.avatar_url } : {}),
    ...(base.display_style ? { display_style: base.display_style } : {}),
    ...(base.frame_url ? { frame_url: base.frame_url } : {}),
    ...(base.input_type ? { input_type: base.input_type } : {}),
  };
  return mergeCosmeticFields(merged, profile as unknown as Record<string, unknown>);
}

async function loadBattlePlayerProfilePeekOnly(steamId: string): Promise<HudProfile | null> {
  const session = await peekSessionCache({ steamId });
  if (!session?.ok || isProfileInvalidated(session.profile)) {
    if (session && !session.ok) {
      return null;
    }
    return null;
  }
  return session.profile;
}

async function loadBattlePlayerProfile(
  steamId: string,
  state: HudBattleOk['state'],
  peekOnly: boolean,
): Promise<HudProfile | null> {
  if (peekOnly) {
    const profile = await loadBattlePlayerProfilePeekOnly(steamId);
    logBattleEnrich(state, steamId, profile ? 'peek' : 'snapshot');
    return profile;
  }

  const profileResult = await getPlayerCached({ steamId });
  if (!profileResult.ok) {
    logBattleEnrich(state, steamId, 'convex', profileResult.reason);
    return null;
  }
  if (isProfileInvalidated(profileResult.profile)) {
    logBattleEnrich(state, steamId, 'convex', 'user_invalidated');
    return null;
  }
  logBattleEnrich(state, steamId, 'cache');
  return profileResult.profile;
}

async function enrichBattlePlayer(
  battle: HudBattleSnapshotOk,
  player: HudBattlePlayerSnapshot,
  peekOnly: boolean,
): Promise<HudBattlePlayer> {
  const base = normalizeBattlePlayerSnapshot(player);

  const profile = await loadBattlePlayerProfile(player.steamId, battle.state, peekOnly);
  if (!profile) {
    return base;
  }

  return mapProfileToBattlePlayer(base, profile);
}

export async function enrichBattleWithProfiles(battle: HudBattleSnapshotOk): Promise<HudBattleOk> {
  const peekOnly = shouldPeekOnlyBattleEnrich(battle.state);
  const [player1, player2] = await Promise.all([
    enrichBattlePlayer(battle, battle.player1, peekOnly),
    enrichBattlePlayer(battle, battle.player2, peekOnly),
  ]);

  return {
    ...battle,
    player1,
    player2,
  };
}

export type GetBattleCachedOptions = {
  enrich?: boolean;
};

function normalizeBattleSnapshot(battle: HudBattleSnapshotOk): HudBattleOk {
  return {
    ...battle,
    player1: normalizeBattlePlayerSnapshot(battle.player1),
    player2: normalizeBattlePlayerSnapshot(battle.player2),
  };
}

export async function getBattleCachedFast(
  params: BattleCacheParams,
  options?: GetBattleCachedOptions,
): Promise<HudBattleResult> {
  const cacheKey = buildBattleCacheKey(params);
  const cached = await hudRedisGet(battleRedisKey(cacheKey));
  if (!cached) {
    return { ok: false, reason: 'no_battle' };
  }

  const battle = JSON.parse(cached) as HudBattleSnapshotOk;
  if (!battle.ok) {
    return { ok: false, reason: 'no_battle' };
  }

  if (options?.enrich === true) {
    return enrichBattleWithProfiles(battle);
  }

  return normalizeBattleSnapshot(battle);
}

export async function getBattleCached(params: BattleCacheParams): Promise<HudBattleResult> {
  return getBattleCachedFast(params, { enrich: true });
}

/** Test helper: derive profile from peek-only session cache (no Convex). */
export async function peekBattlePlayerProfile(steamId: string): Promise<HudProfile | null> {
  const session = await peekSessionCache({ steamId });
  if (!session?.ok || isProfileInvalidated(session.profile)) {
    return null;
  }
  const player = playerResultFromSession(session);
  return player.ok ? player.profile : null;
}
