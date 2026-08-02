import { scheduleHudRefreshAfterBattleFinished } from '../hud/hudRefreshScheduler.js';
import type { EventPayload } from './types.js';

export async function handleBattleFinishedAfterIngest(payload: EventPayload): Promise<void> {
  scheduleHudRefreshAfterBattleFinished(payload);
}
