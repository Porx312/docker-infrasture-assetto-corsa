import { scheduleHudRefreshAfterBattleFinished } from '../hud/hudRefreshScheduler.js';
import type { EventPayload } from './types.js';

/** Repush battle WSS from Redis when listeners exist; no proactive getHudSession (ELO via ProjectD battle_elo webhook). */
export async function handleBattleFinishedAfterIngest(payload: EventPayload): Promise<void> {
  scheduleHudRefreshAfterBattleFinished(payload);
}
