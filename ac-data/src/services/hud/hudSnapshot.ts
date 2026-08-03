import type { Request, Response } from 'express';

import { isHudSseEnabled } from './battleHudPush.js';
import { fetchHudVersion, isHudConvexConfigured } from './hudConvex.js';
import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import { resolvePlayerPresence } from './hudPlayerPresence.js';
import { isHudRedisConfigured } from './hudRedis.js';
import {
  buildHudSessionEvent,
  buildHudVersionEvent,
  loadHudSessionForSse,
} from './hudSsePush.js';
import type { HudVersionOk } from './hudTypes.js';
import { markUserInvalidated } from './hudUserInvalidation.js';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

/** One-shot JSON snapshot for CSP clients that cannot stream SSE over web.get. */
export async function handleHudSnapshot(req: Request, res: Response): Promise<void> {
  if (!isHudRedisConfigured() || !isHudSseEnabled()) {
    res.status(404).json({ ok: false, reason: 'HUD disabled' });
    return;
  }

  const steamId = requireQueryString(req.query.steamId);
  if (!steamId) {
    res.status(400).json({ ok: false, reason: 'steamId is required' });
    return;
  }

  const auth = requireHudApiKeyFromQuery(req.query.api_key);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  if (!isHudConvexConfigured()) {
    res.status(404).json({ ok: false, reason: 'user_not_found' });
    return;
  }

  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    res.status(404).json({ ok: false, reason: resolved.reason });
    return;
  }

  const versionResult = await fetchHudVersion({
    steamId,
    now: Date.now(),
  });

  if (!versionResult.ok) {
    res.status(404).json({ ok: false, reason: versionResult.reason });
    return;
  }

  const session = await loadHudSessionForSse(steamId, false);
  if (!session.ok) {
    if (session.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    res.status(404).json({ ok: false, reason: session.reason });
    return;
  }

  const versionForClient: HudVersionOk = {
    ...versionResult,
    version: session.version,
  };

  res.json({
    ok: true,
    steamId,
    version: buildHudVersionEvent(steamId, versionForClient),
    session: buildHudSessionEvent(steamId, session),
  });
}
