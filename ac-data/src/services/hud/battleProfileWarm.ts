import { refreshPlayerHudCache } from './lapCompletedHudRefresh.js';
import type { HudBattleOk, HudBattleSnapshotOk } from './hudTypes.js';

const WARM_DEDUPE_TTL_MS = 60_000;
const warmedBattleIds = new Map<string, number>();

function battleEnrichLogEnabled(): boolean {
  return (process.env.HUD_BATTLE_ENRICH_LOG ?? 'false').trim().toLowerCase() === 'true';
}

function pruneWarmDedupe(now: number): void {
  for (const [battleId, expiresAt] of warmedBattleIds) {
    if (expiresAt <= now) {
      warmedBattleIds.delete(battleId);
    }
  }
}

function shouldWarmBattle(battleId: string | null, now: number): battleId is string {
  if (!battleId) {
    return false;
  }
  pruneWarmDedupe(now);
  const expiresAt = warmedBattleIds.get(battleId);
  if (expiresAt !== undefined && expiresAt > now) {
    return false;
  }
  warmedBattleIds.set(battleId, now + WARM_DEDUPE_TTL_MS);
  return true;
}

/** Fire-and-forget Convex refresh for both pilots when a battle pair locks. */
export function maybeWarmBattleProfiles(battle: HudBattleSnapshotOk | HudBattleOk): void {
  if (battle.state !== 'pairing' || !battle.ok) {
    return;
  }
  const now = Date.now();
  if (!shouldWarmBattle(battle.battleId, now)) {
    return;
  }

  const steamIds = [battle.player1.steamId, battle.player2.steamId].filter(Boolean);
  if (steamIds.length === 0) {
    return;
  }

  if (battleEnrichLogEnabled()) {
    console.log(
      `[battle-enrich] prewarm battleId=${battle.battleId} steamIds=${steamIds.join(',')}`,
    );
  }

  for (const steamId of steamIds) {
    void refreshPlayerHudCache({ steamId, source: 'battle' }).catch((err) => {
      console.warn(
        `[battle-enrich] prewarm failed battleId=${battle.battleId} steamId=${steamId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
}

/** Test helper: reset in-memory warm dedupe. */
export function resetBattleProfileWarmForTests(): void {
  warmedBattleIds.clear();
}
