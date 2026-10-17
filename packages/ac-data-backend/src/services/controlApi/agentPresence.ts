import { hudRedisGet, hudRedisSet, isHudRedisConfigured } from '@projectd/ac-data-shared/services/hud/hudRedis.js';
import { AGENT_PRESENCE_TTL_SEC, instanceAgentKey } from './redisKeys.js';

export type AgentServerSlot = {
  serverId?: string;
  name?: string;
  status?: string;
  playerCount?: number;
  /** HTTP_PORT from edge server_cfg — used for acstuff join URLs. */
  httpPort?: number;
};

export type AgentPresenceDoc = {
  instanceId: string;
  region?: string;
  agentVersion?: string;
  servers: AgentServerSlot[];
  registeredAt: number;
  lastSeenAt: number;
};

export type StoreAgentPresenceInput = {
  instanceId: string;
  region?: string;
  agentVersion?: string;
  servers?: AgentServerSlot[];
  /** When true, keep previous registeredAt if present. */
  isHeartbeat?: boolean;
};

function normalizeServers(raw: unknown): AgentServerSlot[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const httpPortRaw = row.httpPort;
      const httpPort =
        typeof httpPortRaw === 'number' &&
        Number.isFinite(httpPortRaw) &&
        httpPortRaw > 0
          ? Math.trunc(httpPortRaw)
          : undefined;
      return {
        serverId: typeof row.serverId === 'string' ? row.serverId : undefined,
        name: typeof row.name === 'string' ? row.name : undefined,
        status: typeof row.status === 'string' ? row.status : undefined,
        playerCount: typeof row.playerCount === 'number' ? row.playerCount : undefined,
        ...(httpPort != null ? { httpPort } : {}),
      };
    });
}

export async function storeAgentPresence(
  input: StoreAgentPresenceInput,
): Promise<{ doc: AgentPresenceDoc; expiresInSec: number; previousServers: AgentServerSlot[] }> {
  if (!isHudRedisConfigured()) {
    throw new Error('redis_unavailable');
  }
  const instanceId = input.instanceId.trim();
  if (!instanceId) {
    throw new Error('instanceId_required');
  }

  const key = instanceAgentKey(instanceId);
  const now = Date.now();
  let registeredAt = now;
  let prev: AgentPresenceDoc | null = null;
  if (input.isHeartbeat) {
    prev = await getAgentPresence(instanceId);
    if (prev?.registeredAt) {
      registeredAt = prev.registeredAt;
    }
  } else {
    prev = await getAgentPresence(instanceId);
  }

  // Omitted `servers` on heartbeat keeps previous (glitch / partial payload).
  // Explicit `servers: []` clears (e.g. last folder deprovisioned).
  let servers =
    input.isHeartbeat && input.servers === undefined && prev?.servers?.length
      ? prev.servers
      : normalizeServers(input.servers);

  const doc: AgentPresenceDoc = {
    instanceId,
    region: input.region?.trim() || undefined,
    agentVersion: input.agentVersion?.trim() || undefined,
    servers,
    registeredAt,
    lastSeenAt: now,
  };

  const ttl = AGENT_PRESENCE_TTL_SEC;
  await hudRedisSet(key, JSON.stringify(doc), ttl);
  return { doc, expiresInSec: ttl, previousServers: prev?.servers ?? [] };
}

export async function getAgentPresence(instanceId: string): Promise<AgentPresenceDoc | null> {
  if (!isHudRedisConfigured()) {
    return null;
  }
  const id = instanceId.trim();
  if (!id) {
    return null;
  }
  const raw = await hudRedisGet(instanceAgentKey(id));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AgentPresenceDoc;
    if (!parsed || typeof parsed !== 'object' || parsed.instanceId !== id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
