import type { Request, Response } from 'express';

import { getBattleCachedFast } from './battleHudReader.js';
import { battleLiveEnrichEnabled, isHudSseEnabled } from './battleHudPush.js';
import { battleRoomFromParams, parseBattleScopeKey } from './hudBattleRooms.js';
import { fetchHudVersion, isHudConvexConfigured } from './hudConvex.js';
import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import { lookupManagedServer } from './hudManagedServers.js';
import { resolvePlayerPresence } from './hudPlayerPresence.js';
import { shouldBypassSessionCacheForPresence, sessionContextServerName } from './hudSessionPresence.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { getSessionCached } from './lapCompletedHudRefresh.js';
import {
  buildHudSessionEvent,
  buildHudVersionEvent,
  loadHudSessionForSse,
} from './hudSsePush.js';
import type { HudVersionOk } from './hudTypes.js';
import { markHudSseConnected } from './hudSsePresence.js';
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

  const auth = requireHudApiKeyFromQuery(req.query.api_key, req.headers['x-api-key']);
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
    console.log(
      `[hud-snapshot] steamId=${steamId} presenceServer=? managed=? reason=${resolved.reason}`,
    );
    res.status(404).json({ ok: false, reason: resolved.reason });
    return;
  }

  const managed = lookupManagedServer(resolved.presence.serverName);

  const versionResult = await fetchHudVersion({
    steamId,
    now: Date.now(),
  });

  if (!versionResult.ok) {
    res.status(404).json({ ok: false, reason: versionResult.reason });
    return;
  }

  const cachedSession = await getSessionCached({ steamId });
  const bypassSessionCache = await shouldBypassSessionCacheForPresence(
    steamId,
    resolved.presence.serverName,
  );
  let session =
    !bypassSessionCache && cachedSession.ok && cachedSession.version === versionResult.version
      ? cachedSession
      : await loadHudSessionForSse(steamId, bypassSessionCache);
  if (!session.ok) {
    if (session.reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    console.log(
      `[hud-snapshot] steamId=${steamId} presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=false reason=${session.reason}`,
    );
    res.status(404).json({ ok: false, reason: session.reason });
    return;
  }

  console.log(
    `[hud-snapshot] steamId=${steamId} presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=true context_server=${sessionContextServerName(session)} version=${session.version}`,
  );

  const versionForClient: HudVersionOk = {
    ...versionResult,
    version: session.version,
  };

  const battleRoom = battleRoomFromParams(resolved.presence.serverName, steamId);
  const battleParams = parseBattleScopeKey(battleRoom);
  const battle = battleParams
    ? await getBattleCachedFast(battleParams, { enrich: battleLiveEnrichEnabled() })
    : { ok: false as const, reason: 'no_battle' };

  await markHudSseConnected(steamId);

  res.json({
    ok: true,
    steamId,
    version: buildHudVersionEvent(steamId, versionForClient),
    session: buildHudSessionEvent(steamId, session),
    battle,
  });
}
