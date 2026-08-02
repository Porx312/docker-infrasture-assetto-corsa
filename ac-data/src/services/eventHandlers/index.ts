import { handleBattleFinishedAfterIngest } from './battleFinished.js';
import { handleLapCompletedAfterIngest } from './lapCompleted.js';
import { handlePlayerJoinAfterIngest } from './playerJoin.js';
import { handlePlayerLeaveAfterIngest } from './playerLeave.js';
import { handleServerStatusBeforeIngest } from './serverStatus.js';
import type { EventPayload } from './types.js';

export { handleServerStatusBeforeIngest } from './serverStatus.js';

export async function handleEventBeforeIngest(event: string, payload: EventPayload): Promise<void> {
  if (event === 'server_status') {
    await handleServerStatusBeforeIngest(payload);
  }
}

export async function handleEventAfterIngest(event: string, payload: EventPayload): Promise<void> {
  switch (event) {
    case 'player_join':
      await handlePlayerJoinAfterIngest(payload);
      break;
    case 'player_leave':
      await handlePlayerLeaveAfterIngest(payload);
      break;
    case 'lap_completed':
      await handleLapCompletedAfterIngest(payload);
      break;
    case 'battle_finished':
      await handleBattleFinishedAfterIngest(payload);
      break;
    default:
      break;
  }
}
