import type { Request, Response } from 'express';

import { getBattleCachedFast } from './battleHudReader.js';
import { shouldStartHudPushHub } from './battleHudPush.js';
import { battleRoomFromParams, parseBattleScopeKey } from './hudBattleRooms.js';
import { isHudConvexConfigured } from './hudConvex.js';
import { requireHudApiKeyFromQuery } from './hudBattleAuth.js';
import { lookupManagedServer } from './hudManagedServers.js';
import { resolvePlayerPresence } from './hudPlayerPresence.js';
import {
  sessionContextServerName,
  shouldRefreshJoinContextForPresence,
} from './hudSessionPresence.js';
import { isHudRedisConfigured } from './hudRedis.js';
import { peekSessionCache } from './lapCompletedHudRefresh.js';
import { refreshPlayerJoinFromConvex } from './playerJoinContext.js';
import { buildHudVersionForSession } from './hudClientVersion.js';
import {
  buildHudSessionEvent,
  buildHudVersionEvent,
} from './hudPushHub.js';
import { normalizeHudProfile, profileCosmeticsFingerprint } from './hudProfile.js';
import {
  readProfileCosmeticsFingerprint,
  syncProfileCosmeticsFromProfile,
} from './hudProfileCosmetics.js';
import { parseHudSnapshotSections } from './hudSnapshotSections.js';
import type { HudBattleErr, HudBattleOk, HudSessionResult, HudVersionOk } from './hudTypes.js';
import { markHudConnConnected } from './hudConnPresence.js';
import { markUserInvalidated } from './hudUserInvalidation.js';

function requireQueryString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

type SessionSnapshotPayload = {
  version: Record<string, unknown>;
  session: Record<string, unknown>;
  sessionResult: HudSessionResult;
  versionForClient: HudVersionOk;
};

async function loadSessionSnapshotPayload(
  steamId: string,
  serverName: string,
  presenceCarModel?: string,
): Promise<
  | { ok: true; payload: SessionSnapshotPayload }
  | { ok: false; reason: string; logLine: string }
> {
  const managed = lookupManagedServer(serverName);

  const refreshJoin = await shouldRefreshJoinContextForPresence(
    steamId,
    serverName,
    presenceCarModel,
  );
  if (refreshJoin) {
    await refreshPlayerJoinFromConvex(steamId);
  }

  const session = await peekSessionCache({ steamId });
  if (!session?.ok) {
    const reason = session?.reason ?? 'player_not_connected';
    if (reason === 'user_invalidated') {
      await markUserInvalidated(steamId);
    }
    return {
      ok: false,
      reason,
      logLine: `[hud-snapshot] steamId=${steamId} presenceServer=${serverName} managed=${managed?.folderSlug ?? '?'} session_ok=false reason=${reason}`,
    };
  }

  const profile = session.profile ? normalizeHudProfile(session.profile) : null;
  if (profile) {
    const nextFp = profileCosmeticsFingerprint(profile);
    const previousFp = (await readProfileCosmeticsFingerprint(steamId)) ?? '';
    if (previousFp !== nextFp) {
      await syncProfileCosmeticsFromProfile(steamId, profile);
    }
  }

  const cosmeticsFp =
    (profile ? profileCosmeticsFingerprint(profile) : '') ||
    (await readProfileCosmeticsFingerprint(steamId)) ||
    '';
  const versionForClient: HudVersionOk = buildHudVersionForSession(session, cosmeticsFp);

  return {
    ok: true,
    payload: {
      version: buildHudVersionEvent(steamId, versionForClient),
      session: buildHudSessionEvent(steamId, session),
      sessionResult: session,
      versionForClient,
    },
  };
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
  return getBattleCachedFast(battleParams, { enrich: true });
}

/** Battle-only snapshot: Redis battle path, no Convex session/version. */
export async function handleHudBattleSnapshot(
  steamId: string,
  serverName: string,
): Promise<{ ok: true; steamId: string; sections: 'battle'; battle: HudBattleOk | HudBattleErr }> {
  const battle = await loadBattleSnapshotForPresence(serverName, steamId);
  await markHudConnConnected(steamId);
  return {
    ok: true,
    steamId,
    sections: 'battle',
    battle,
  };
}

/** One-shot JSON snapshot for CSP clients that cannot stream SSE over web.get. */
export async function handleHudSnapshot(req: Request, res: Response): Promise<void> {
  if (!isHudRedisConfigured() || !shouldStartHudPushHub()) {
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

  const sessionLoad = await loadSessionSnapshotPayload(
    steamId,
    resolved.presence.serverName,
    resolved.presence.carModel,
  );
  if (!sessionLoad.ok) {
    console.log(sessionLoad.logLine);
    res.status(404).json({ ok: false, reason: sessionLoad.reason });
    return;
  }

  const { payload } = sessionLoad;
  const managed = lookupManagedServer(resolved.presence.serverName);

  if (sections === 'session') {
    const sessionVersion = payload.sessionResult.ok ? payload.sessionResult.version : '-';
    console.log(
      `[hud-snapshot] steamId=${steamId} sections=session presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=true context_server=${sessionContextServerName(payload.sessionResult)} version=${sessionVersion}`,
    );
    await markHudConnConnected(steamId);
    res.json({
      ok: true,
      steamId,
      sections: 'session',
      version: payload.version,
      session: payload.session,
    });
    return;
  }

  const sessionVersion = payload.sessionResult.ok ? payload.sessionResult.version : '-';
  console.log(
    `[hud-snapshot] steamId=${steamId} sections=full presenceServer=${resolved.presence.serverName} managed=${managed?.folderSlug ?? '?'} session_ok=true context_server=${sessionContextServerName(payload.sessionResult)} version=${sessionVersion}`,
  );

  const battle = await loadBattleSnapshotForPresence(resolved.presence.serverName, steamId);

  await markHudConnConnected(steamId);

  res.json({
    ok: true,
    steamId,
    sections: 'full',
    version: payload.version,
    session: payload.session,
    battle,
  });
}
