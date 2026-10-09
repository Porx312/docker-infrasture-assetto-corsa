import { normalizeHudServerName } from '@projectd/ac-data-shared/services/hud/hudQueryNormalize.js';
import { parseHudPresenceRecordJson } from '@projectd/ac-data-shared/services/hud/hudPresenceRecord.js';
import {
  presenceRedisKey,
  presenceRosterRedisKey,
  parsePresenceRosterKeySuffix,
} from '../hud/hudCacheKeys.js';
import {
  getHudRedisClient,
  hudRedisGet,
  isHudRedisConfigured,
} from '../hud/hudRedis.js';
import type { HubPlayerPresenceRecord } from '../hud/hudPlayerRouting.js';
import { resolveServerJoinEndpoint } from './joinEndpoint.js';

export type LivePlayerRow = {
  steamId: string;
  name?: string;
  carModel: string;
  track: string;
  trackConfig: string;
  instanceId?: string;
  folderSlug?: string;
  updatedAt: number;
};

export type LiveJoinFields = {
  ip: string | null;
  httpPort: number | null;
  joinUrl: string | null;
};

export type LiveServerResponse = {
  ok: true;
  serverId: string;
  instanceId: string | null;
  players: LivePlayerRow[];
  updatedAt: number | null;
} & LiveJoinFields;

export type LiveSummaryServer = {
  serverId: string;
  instanceId: string | null;
  playerCount: number;
  updatedAt: number | null;
} & LiveJoinFields;

const ROSTER_PREFIX = 'ac:hud:presence:roster:';

/** Parse `instanceId:lobby` composite or plain lobby name. */
export function parseLiveServerRef(serverIdRaw: string): {
  serverId: string;
  instanceId: string | null;
} {
  const trimmed = serverIdRaw.trim();
  const sep = trimmed.indexOf(':');
  if (sep > 0) {
    const maybeInstance = trimmed.slice(0, sep).trim();
    const maybeServer = trimmed.slice(sep + 1).trim();
    // Composite only when both sides look non-empty and server side normalizes.
    if (maybeInstance && maybeServer) {
      return { serverId: maybeServer, instanceId: maybeInstance };
    }
  }
  return { serverId: trimmed, instanceId: null };
}

async function readPresence(steamId: string): Promise<HubPlayerPresenceRecord | null> {
  const raw = await hudRedisGet(presenceRedisKey(steamId));
  if (!raw) {
    return null;
  }
  return parseHudPresenceRecordJson(raw);
}

function parseSteamIdList(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

async function readRosterSteamIds(
  normalizedServerId: string,
  instanceId?: string | null,
): Promise<{ steamIds: string[]; resolvedInstanceId: string | null }> {
  if (instanceId) {
    const scopedRaw = await hudRedisGet(presenceRosterRedisKey(normalizedServerId, instanceId));
    if (scopedRaw) {
      return { steamIds: parseSteamIdList(scopedRaw), resolvedInstanceId: instanceId };
    }
    const legacyRaw = await hudRedisGet(presenceRosterRedisKey(normalizedServerId));
    return { steamIds: parseSteamIdList(legacyRaw), resolvedInstanceId: instanceId };
  }

  // No instanceId: discover scoped keys `roster:{instanceId}:{server}` + legacy unscoped.
  const redis = await getHudRedisClient();
  // Redis MATCH: ac:hud:presence:roster:*:normalizedServerId
  const pattern = `${ROSTER_PREFIX}*:${normalizedServerId}`;
  const steamIds = new Set<string>();
  let resolvedInstanceId: string | null = null;

  let cursor = '0';
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = String(result.cursor);
    for (const key of result.keys) {
      const suffix = key.slice(ROSTER_PREFIX.length);
      const parsed = parsePresenceRosterKeySuffix(suffix);
      if (parsed.serverId !== normalizedServerId) {
        continue;
      }
      if (parsed.instanceId && !resolvedInstanceId) {
        resolvedInstanceId = parsed.instanceId;
      }
      for (const id of parseSteamIdList(await hudRedisGet(key))) {
        steamIds.add(id);
      }
    }
  } while (cursor !== '0');

  // Legacy unscoped key (pre-scoping writers).
  for (const id of parseSteamIdList(await hudRedisGet(presenceRosterRedisKey(normalizedServerId)))) {
    steamIds.add(id);
  }

  return { steamIds: [...steamIds], resolvedInstanceId };
}

export async function getServerLiveRoster(
  serverId: string,
  instanceIdHint?: string | null,
): Promise<LiveServerResponse | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const parsed = parseLiveServerRef(serverId);
  const instanceId = (instanceIdHint || parsed.instanceId || '').trim() || null;
  const normalized = normalizeHudServerName(parsed.serverId);
  if (!normalized) {
    return null;
  }

  const { steamIds, resolvedInstanceId: fromKeys } = await readRosterSteamIds(
    normalized,
    instanceId,
  );
  const players: LivePlayerRow[] = [];
  let updatedAt: number | null = null;
  let resolvedInstanceId: string | null = instanceId ?? fromKeys;

  for (const steamId of steamIds) {
    const presence = await readPresence(steamId);
    if (!presence) {
      players.push({
        steamId,
        carModel: '',
        track: '',
        trackConfig: '',
        updatedAt: 0,
      });
      continue;
    }
    if (
      instanceId &&
      presence.instanceId &&
      presence.instanceId.trim() !== instanceId
    ) {
      continue;
    }
    if (!resolvedInstanceId && presence.instanceId) {
      resolvedInstanceId = presence.instanceId;
    }
    if (updatedAt === null || presence.updatedAt > updatedAt) {
      updatedAt = presence.updatedAt;
    }
    players.push({
      steamId,
      name: presence.name,
      carModel: presence.carModel,
      track: presence.track,
      trackConfig: presence.trackConfig,
      instanceId: presence.instanceId,
      folderSlug: presence.folderSlug,
      updatedAt: presence.updatedAt,
    });
  }

  const folderSlug =
    players.find((p) => typeof p.folderSlug === 'string' && p.folderSlug.trim())
      ?.folderSlug ?? null;
  const join = await resolveServerJoinEndpoint({
    instanceId: resolvedInstanceId,
    lobbyName: normalized,
    folderSlug,
  });

  return {
    ok: true,
    serverId: normalized,
    instanceId: resolvedInstanceId,
    players,
    updatedAt,
    ip: join.ip,
    httpPort: join.httpPort,
    joinUrl: join.joinUrl,
  };
}

export async function getLiveSummary(): Promise<{ ok: true; servers: LiveSummaryServer[] } | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }

  const redis = await getHudRedisClient();
  const servers: LiveSummaryServer[] = [];

  let cursor = '0';
  do {
    const result = await redis.scan(cursor, {
      MATCH: `${ROSTER_PREFIX}*`,
      COUNT: 100,
    });
    cursor = String(result.cursor);
    for (const key of result.keys) {
      const suffix = key.slice(ROSTER_PREFIX.length);
      if (!suffix) {
        continue;
      }
      const { instanceId, serverId } = parsePresenceRosterKeySuffix(suffix);
      if (!serverId) {
        continue;
      }
      const { steamIds } = await readRosterSteamIds(serverId, instanceId);
      let updatedAt: number | null = null;
      let folderSlug: string | null = null;
      for (const steamId of steamIds.slice(0, 5)) {
        const presence = await readPresence(steamId);
        if (presence && (updatedAt === null || presence.updatedAt > updatedAt)) {
          updatedAt = presence.updatedAt;
        }
        if (!folderSlug && presence?.folderSlug?.trim()) {
          folderSlug = presence.folderSlug.trim();
        }
      }
      const join = await resolveServerJoinEndpoint({
        instanceId,
        lobbyName: serverId,
        folderSlug,
      });
      servers.push({
        serverId,
        instanceId,
        playerCount: steamIds.length,
        updatedAt,
        ip: join.ip,
        httpPort: join.httpPort,
        joinUrl: join.joinUrl,
      });
    }
  } while (cursor !== '0');

  servers.sort((a, b) => {
    const left = `${a.instanceId ?? ''}:${a.serverId}`;
    const right = `${b.instanceId ?? ''}:${b.serverId}`;
    return left.localeCompare(right);
  });
  return { ok: true, servers };
}
