import type { RedisClientType } from 'redis';

import { isBattleScopeKey } from './hudBattleRooms.js';
import { isHudUpdateScopeKey, parseBoardScopeKey, parsePlayerScopeKey } from './hudScopeKeys.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { HUD_UPDATES_CHANNEL } from './hudVersion.js';
import { createRedisClient } from '../redisClient.js';

export type HudUpdateMessage = {
  scopeKey: string;
  version: string;
  ts: number;
};

export type HudUpdateHandlers = {
  onBattleUpdate?: (message: HudUpdateMessage) => void;
  onBoardUpdate?: (message: HudUpdateMessage) => void;
  onPlayerUpdate?: (message: HudUpdateMessage) => void;
};

let subscriber: RedisClientType | null = null;
let activeHandlers: HudUpdateHandlers = {};

export function parseHudUpdateMessage(raw: string): HudUpdateMessage | null {
  try {
    const parsed = JSON.parse(raw) as { scopeKey?: unknown; version?: unknown; ts?: unknown };
    if (typeof parsed.scopeKey !== 'string' || !isHudUpdateScopeKey(parsed.scopeKey)) {
      return null;
    }
    return {
      scopeKey: parsed.scopeKey,
      version: typeof parsed.version === 'string' ? parsed.version : String(parsed.version ?? ''),
      ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
    };
  } catch {
    return null;
  }
}

function routeHudUpdate(update: HudUpdateMessage): void {
  const { scopeKey } = update;
  if (isBattleScopeKey(scopeKey)) {
    activeHandlers.onBattleUpdate?.(update);
    return;
  }
  if (parseBoardScopeKey(scopeKey)) {
    activeHandlers.onBoardUpdate?.(update);
    return;
  }
  if (parsePlayerScopeKey(scopeKey)) {
    activeHandlers.onPlayerUpdate?.(update);
  }
}

function createSubscriberClient(): RedisClientType {
  return createRedisClient('hud-updates-subscriber');
}

export async function startHudUpdatesSubscriber(handlers: HudUpdateHandlers): Promise<void> {
  if (!isHudRedisConfigured()) {
    console.log('[hud-updates-subscriber] skipped (redis not configured)');
    return;
  }

  activeHandlers = handlers;

  if (subscriber?.isOpen) {
    return;
  }

  subscriber = createSubscriberClient();
  subscriber.on('error', (err) => console.error('[hud-updates-subscriber] redis error:', err));

  await subscriber.connect();
  await subscriber.subscribe(HUD_UPDATES_CHANNEL, (message) => {
    const update = parseHudUpdateMessage(message);
    if (update) {
      routeHudUpdate(update);
    }
  });

  console.log(`[hud-updates-subscriber] listening channel=${HUD_UPDATES_CHANNEL}`);
}

export async function stopHudUpdatesSubscriber(): Promise<void> {
  if (!subscriber?.isOpen) {
    return;
  }
  await subscriber.unsubscribe(HUD_UPDATES_CHANNEL);
  await subscriber.quit();
  subscriber = null;
  activeHandlers = {};
}
