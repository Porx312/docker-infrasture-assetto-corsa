import {
  battleRedisKey,
  buildBattleCacheKey,
} from './hudCacheKeys.js';
import { getPlayerCached } from './lapCompletedHudRefresh.js';
import { isProfileInvalidated, mergeCosmeticFields } from './hudProfile.js';
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
    ...(profile.avatar_url ? { avatar_url: profile.avatar_url } : {}),
    ...(base.display_style ? { display_style: base.display_style } : {}),
    ...(base.frame_url ? { frame_url: base.frame_url } : {}),
    ...(base.input_type ? { input_type: base.input_type } : {}),
  };
  return mergeCosmeticFields(merged, profile as unknown as Record<string, unknown>);
}

async function enrichBattlePlayer(
  battle: HudBattleSnapshotOk,
  player: HudBattlePlayerSnapshot,
): Promise<HudBattlePlayer> {
  const base = normalizeBattlePlayerSnapshot(player);

  const profileResult = await getPlayerCached({
    steamId: player.steamId,
  });

  if (!profileResult.ok || isProfileInvalidated(profileResult.profile)) {
    return base;
  }

  const profile = profileResult.profile;
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

export async function getBattleCached(params: BattleCacheParams): Promise<HudBattleResult> {
  const cacheKey = buildBattleCacheKey(params);
  const cached = await hudRedisGet(battleRedisKey(cacheKey));
  if (!cached) {
    return { ok: false, reason: 'no_battle' };
  }

  const battle = JSON.parse(cached) as HudBattleSnapshotOk;
  if (!battle.ok) {
    return { ok: false, reason: 'no_battle' };
  }

  return enrichBattleWithProfiles(battle);
}
