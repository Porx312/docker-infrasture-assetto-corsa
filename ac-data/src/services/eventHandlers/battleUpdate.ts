import { scheduleHudRefreshAfterBattleUpdate } from '../hud/hudRefreshScheduler.js';
import type { EventPayload } from './types.js';

export async function handleBattleUpdateAfterIngest(payload: EventPayload): Promise<void> {
  scheduleHudRefreshAfterBattleUpdate(payload as Record<string, unknown>);
}
