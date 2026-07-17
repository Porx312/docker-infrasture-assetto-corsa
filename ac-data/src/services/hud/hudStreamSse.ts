import type { Request, Response } from 'express';

import {
  initHudPushHub,
  isHudSseEnabled,
  sendInitialBattleSnapshot,
  subscribeBattleHudRoom,
  unsubscribeBattleHudRoom,
  type BattleHudRoomListener,
} from './battleHudPush.js';
import { battleRoomFromParams } from './hudBattleRooms.js';
import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import {
  refreshPlayerPresence,
  registerBattleSsePresence,
  resolvePlayerPresence,
  unregisterBattleSsePresence,
} from './hudPlayerPresence.js';
import {
  registerHudSseConnection,
  sendInitialHudSseSnapshot,
  type HudSseConnection,
} from './hudSsePush.js';
import { isHudRedisConfigured } from './hudRedis.js';
import {
  clearHudSsePresence,
  markHudSseConnected,
  renewHudSsePresence,
} from './hudSsePresence.js';
import { writeSseEvent } from './hudStreamSseFormat.js';

const SSE_KEEPALIVE_MS = Number(process.env.HUD_SSE_KEEPALIVE_MS || 30_000);

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export async function handleHudStreamSse(req: Request, res: Response): Promise<void> {
  if (!isHudRedisConfigured() || !isHudSseEnabled()) {
    res.status(404).json({ error: 'HUD SSE disabled' });
    return;
  }

  const steamId = requireQueryString(req.query.steamId);
  if (!steamId) {
    res.status(400).json({ error: 'steamId is required' });
    return;
  }

  const auth = requireHudApiKeyFromQuery(req.query.api_key);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    res.status(404).json({ ok: false, reason: resolved.reason });
    return;
  }

  registerBattleSsePresence(resolved.presence);
  await markHudSseConnected(steamId);
  initHudPushHub();

  const battleRoom = battleRoomFromParams(resolved.presence.serverName, steamId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const hudConn: HudSseConnection = {
    steamId,
    lastVersionFingerprint: null,
    listener: (event, payload) => {
      writeSseEvent(res, event, payload);
    },
  };

  const unregisterHud = registerHudSseConnection(hudConn);

  const battleListener: BattleHudRoomListener = (event, payload) => {
    writeSseEvent(res, event, payload);
  };

  subscribeBattleHudRoom(battleRoom, battleListener);
  void sendInitialBattleSnapshot(battleRoom, battleListener);
  void sendInitialHudSseSnapshot(hudConn);

  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
    void refreshPlayerPresence(resolved.presence);
    void renewHudSsePresence(steamId);
  }, SSE_KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    unregisterHud();
    unregisterBattleSsePresence(steamId);
    void clearHudSsePresence(steamId);
    unsubscribeBattleHudRoom(battleRoom, battleListener);
  });
}
