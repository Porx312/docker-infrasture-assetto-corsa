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
import { parseHudSnapshotSections } from './hudSnapshotSections.js';
import type { HudBattleErr, HudBattleOk, HudVersionOk } from './hudTypes.js';
import { markHudSseConnected } from './hudSsePresence.js';
import { markUserInvalidated } from './hudUserInvalidation.js';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

async function loadBattleSnapshotForPresence(
  serverName: string,
  steamId: string,
): Promise<HudBattleOk | HudBattleErr> {
  const battleRoom = battleRoomFromParams(serverName, steamId);
  const battleParams = parseBattleScopeKey(battleRoom);
  if (!battleParams) {
    return { ok: false, reason: 'no_battle' };
  }
  return getBattleCachedFast(battleParams, { enrich: battleLiveEnrichEnabled() });
}

/** Battle-only snapshot: Redis battle path, no Convex session/version. */
export async function handleHudBattleSnapshot(
  steamId: string,
  serverName: string,
): Promise<{ ok: true; steamId: string; sections: 'battle'; battle: HudBattleOk | HudBattleErr }> {
  const battle = await loadBattleSnapshotForPresence(serverName, steamId);
  await markHudSseConnected(steamId);
  return {
    ok: true,
    steamId,
    sections: 'battle',
    battle,
  };
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

  const sections = parseHudSnapshotSections(req.query.sections);

  const resolved = await resolvePlayerPresence(steamId);
  if (!resolved.ok) {
    console.log(
      `[hud-snapshot] steamId=${steamId} sections=${sections} presenceServer=? managed=? reason=${resolved.reason}`,
    );
    res.status(404).json({ ok: false, reason: resolved.reason });
    return;
  }

  if (sections === 'battle') {
    console.log(
      `[hud-snapshot] steamId=${steamId} sections=battle presenceServer=${resolved.presence.serverName} (Redis battle only)`,
    );
    const payload = await handleHudBattleSnapshot(steamId, resolved.presence.serverName);
    res.json(payload);
    return;
  }

  if (!isHudConvexConfigured()) {
    res.status(404).json({ ok: false, reason: 'user_not_found' });
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
      `[hud-snapshot] steamId=${steamId} sections=full presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=false reason=${session.reason}`,
    );
    res.status(404).json({ ok: false, reason: session.reason });
    return;
  }

  console.log(
    `[hud-snapshot] steamId=${steamId} sections=full presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=true context_server=${sessionContextServerName(session)} version=${session.version}`,
  );

  const versionForClient: HudVersionOk = {
    ...versionResult,
    version: session.version,
  };

  const battle = await loadBattleSnapshotForPresence(resolved.presence.serverName, steamId);

  await markHudSseConnected(steamId);

  res.json({
    ok: true,
    steamId,
    sections: 'full',
    version: buildHudVersionEvent(steamId, versionForClient),
    session: buildHudSessionEvent(steamId, session),
    battle,
  });
}
