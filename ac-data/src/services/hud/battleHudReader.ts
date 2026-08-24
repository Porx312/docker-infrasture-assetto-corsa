import {
  battleProfileRedisKey,
  battleRedisKey,
  buildBattleCacheKey,
  buildSessionCacheKey,
  sessionRedisKey,
} from './hudCacheKeys.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import { isProfileInvalidated, mergeCosmeticFields } from './hudProfile.js';
import {
  HUD_BATTLE_PROFILE_TTL_SEC,
  HUD_SESSION_TTL_SEC,
  hudRedisGet,
  hudRedisSet,
  hudRedisTouch,
} from './hudRedis.js';
import type {
  BattleCacheParams,
  HudBattleOk,
  HudBattlePlayer,
  HudBattlePlayerSnapshot,
  HudBattleResult,
  HudBattleSnapshotOk,
  HudProfile,
} from './hudTypes.js';

type BattleEnrichSource = 'peek' | 'battle-profile' | 'snapshot' | 'miss';

function battleEnrichLogEnabled(): boolean {
  return (process.env.HUD_BATTLE_ENRICH_LOG ?? 'false').trim().toLowerCase() === 'true';
}

function logBattleEnrich(
  state: HudBattleOk['state'],
  steamId: string,
  source: BattleEnrichSource,
): void {
  if (!battleEnrichLogEnabled()) {
    return;
  }
  console.log(`[battle-enrich] state=${state} steamId=${steamId} source=${source}`);
}

function snapshotCarId(player: HudBattlePlayerSnapshot): string {
  return player.car_id ?? player.car ?? '';
}

function snapshotCosmeticSource(player: HudBattlePlayerSnapshot): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

function battleProfileFromHudProfile(profile: HudProfile): HudProfile {
  return {
    name: profile.name,
    ...(profile.avatar_url ? { avatar_url: profile.avatar_url } : {}),
    ...(profile.display_style !== undefined ? { display_style: profile.display_style } : {}),
    ...(profile.frame_url ? { frame_url: profile.frame_url } : {}),
    ...(profile.tier !== undefined ? { tier: profile.tier } : {}),
    ...(profile.elo !== undefined ? { elo: profile.elo } : {}),
    ...(profile.car_name ? { car_name: profile.car_name } : {}),
    ...(profile.car_id ? { car_id: profile.car_id } : {}),
    ...(profile.input_type ? { input_type: profile.input_type } : {}),
    ...(profile.steam_id ? { steam_id: profile.steam_id } : {}),
  };
}

async function readBattleProfileCache(steamId: string): Promise<HudProfile | null> {
  const trimmed = steamId.trim();
  if (!trimmed) {
    return null;
  }
  const raw = await hudRedisGet(battleProfileRedisKey(trimmed));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as HudProfile;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function persistBattleProfileCache(steamId: string, profile: HudProfile): Promise<void> {
  const trimmed = steamId.trim();
  if (!trimmed) {
    return;
  }
  const subset = battleProfileFromHudProfile(profile);
  await hudRedisSet(
    battleProfileRedisKey(trimmed),
    JSON.stringify(subset),
    HUD_BATTLE_PROFILE_TTL_SEC,
  );
}

async function touchSessionCache(steamId: string): Promise<void> {
  const key = sessionRedisKey(buildSessionCacheKey({ steamId }));
  await hudRedisTouch(key, HUD_SESSION_TTL_SEC);
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

/** Join cache peek + sticky battle profile fallback — never calls Convex during battle enrich. */
async function loadBattlePlayerProfileFromCache(
  steamId: string,
  state: HudBattleOk['state'],
): Promise<HudProfile | null> {
  const session = await peekSessionCache({ steamId });
  if (session === null) {
    const battleProfile = await readBattleProfileCache(steamId);
    if (battleProfile) {
      logBattleEnrich(state, steamId, 'battle-profile');
      return battleProfile;
    }
    logBattleEnrich(state, steamId, 'miss');
    return null;
  }
  if (!session.ok || isProfileInvalidated(session.profile)) {
    logBattleEnrich(state, steamId, 'snapshot');
    return null;
  }
  logBattleEnrich(state, steamId, 'peek');
  await touchSessionCache(steamId);
  if (session.profile) {
    await persistBattleProfileCache(steamId, session.profile);
  }
  return session.profile;
}

async function enrichBattlePlayer(
  battle: HudBattleSnapshotOk,
  player: HudBattlePlayerSnapshot,
): Promise<HudBattlePlayer> {
  const base = normalizeBattlePlayerSnapshot(player);

  const profile = await loadBattlePlayerProfileFromCache(player.steamId, battle.state);
  if (!profile) {
    return base;
  }

  return mapProfileToBattlePlayer(base, profile);
}

export async function enrichBattleWithProfiles(battle: HudBattleSnapshotOk): Promise<HudBattleOk> {
  const [player1, player2] = await Promise.all([
    enrichBattlePlayer(battle, battle.player1),
    enrichBattlePlayer(battle, battle.player2),
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
