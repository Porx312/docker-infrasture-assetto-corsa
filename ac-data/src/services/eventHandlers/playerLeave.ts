import { noteHudPlayerLeave } from '../hud/hudPlayerPresence.js';
import type { EventPayload } from './types.js';

export async function handlePlayerLeaveAfterIngest(payload: EventPayload): Promise<void> {
  await noteHudPlayerLeave(payload);
}
