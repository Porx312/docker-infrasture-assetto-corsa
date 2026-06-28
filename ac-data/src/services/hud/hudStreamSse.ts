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
import { isHudRedisConfigured } from './hudRedis.js';
import {
  sendInitialSessionSnapshot,
  subscribeSessionHudRooms,
  type SessionHudRoomListener,
} from './sessionHudPush.js';

const SSE_KEEPALIVE_MS = Number(process.env.HUD_SSE_KEEPALIVE_MS || 30_000);

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalQueryString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(formatSseEvent(event, data));
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

  const carFilter = optionalQueryString(req.query.carFilter) ?? optionalQueryString(req.query.car);
  const carModel = optionalQueryString(req.query.carModel);

  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    res.status(404).json({ ok: false, reason: resolved.reason });
    return;
  }

  registerBattleSsePresence(resolved.presence);
  initHudPushHub();

  const battleRoom = battleRoomFromParams(resolved.presence.serverName, steamId);
  const sessionParams = {
    steamId,
    serverName: resolved.presence.serverName,
    track: resolved.presence.track,
    trackConfig: resolved.presence.trackConfig ?? '',
    carModel: carModel ?? (resolved.presence.carModel || undefined),
    carFilter,
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const battleListener: BattleHudRoomListener = (event, payload) => {
    writeSseEvent(res, event, payload);
  };

  const sessionListener: SessionHudRoomListener = (event, payload) => {
    writeSseEvent(res, event, payload);
  };

  subscribeBattleHudRoom(battleRoom, battleListener);
  const unsubscribeSession = subscribeSessionHudRooms(sessionParams, sessionListener);

  void sendInitialSessionSnapshot(sessionParams, sessionListener);
  void sendInitialBattleSnapshot(battleRoom, battleListener);

  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
    void refreshPlayerPresence(resolved.presence);
  }, SSE_KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    unregisterBattleSsePresence(steamId);
    unsubscribeBattleHudRoom(battleRoom, battleListener);
    unsubscribeSession();
  });
}
