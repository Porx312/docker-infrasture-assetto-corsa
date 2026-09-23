export type FleetEdge = {
  id: string;
  label: string;
  baseUrl: string;
  instanceId?: string;
};

let cachedFleet: FleetEdge[] | null = null;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeFleetId(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function parseFleetRegistryJson(raw: string): FleetEdge[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const out: FleetEdge[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = normalizeFleetId(key);
    if (!id) {
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out.push({
        id,
        label: key.trim(),
        baseUrl: trimTrailingSlash(value.trim()),
      });
      continue;
    }
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      const baseUrl = typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '';
      if (!baseUrl) {
        continue;
      }
      const label =
        typeof row.label === 'string' && row.label.trim()
          ? row.label.trim()
          : key.trim();
      const instanceId =
        typeof row.instanceId === 'string' ? row.instanceId.trim() : undefined;
      out.push({
        id,
        label,
        baseUrl: trimTrailingSlash(baseUrl),
        instanceId,
      });
    }
  }
  return out;
}

function deriveFromHudEdgeRegistry(): FleetEdge[] {
  const raw = (process.env.HUD_EDGE_REGISTRY || '').trim();
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const byBase = new Map<string, FleetEdge>();
  for (const [lobbyKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    let baseUrl = '';
    let instanceId: string | undefined;
    if (typeof value === 'string' && value.trim()) {
      baseUrl = trimTrailingSlash(value.trim());
    } else if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      baseUrl =
        typeof row.baseUrl === 'string' ? trimTrailingSlash(row.baseUrl.trim()) : '';
      instanceId =
        typeof row.instanceId === 'string' ? row.instanceId.trim() : undefined;
    }
    if (!baseUrl) {
      continue;
    }
    const existing = byBase.get(baseUrl);
    if (existing) {
      if (!existing.instanceId && instanceId) {
        existing.instanceId = instanceId;
      }
      continue;
    }
    const id = instanceId ? normalizeFleetId(instanceId) : normalizeFleetId(lobbyKey);
    byBase.set(baseUrl, {
      id,
      label: instanceId ?? lobbyKey.trim(),
      baseUrl,
      instanceId,
    });
  }
  return [...byBase.values()];
}

function loadFleetEdges(): FleetEdge[] {
  if (cachedFleet) {
    return cachedFleet;
  }
  const fleetRaw = (process.env.FLEET_EDGE_REGISTRY || '').trim();
  if (fleetRaw) {
    try {
      cachedFleet = parseFleetRegistryJson(fleetRaw);
    } catch (err) {
      console.error('[fleet-registry] failed to parse FLEET_EDGE_REGISTRY:', err);
      cachedFleet = [];
    }
    return cachedFleet;
  }
  cachedFleet = deriveFromHudEdgeRegistry();
  return cachedFleet;
}

export function resetFleetRegistryForTests(): void {
  cachedFleet = null;
}

export function listFleetEdges(): FleetEdge[] {
  return loadFleetEdges();
}

export function isFleetModeEnabled(): boolean {
  return listFleetEdges().length > 0;
}

export function resolveFleetEdge(id: string): FleetEdge | null {
  const normalized = normalizeFleetId(id);
  if (!normalized) {
    return null;
  }
  return listFleetEdges().find((edge) => edge.id === normalized) ?? null;
}

export function resolveFleetEdgeBaseUrl(id: string): string | null {
  return resolveFleetEdge(id)?.baseUrl ?? null;
}

/** Match fleet entry by Convex instanceId or normalized fleet id. */
export function resolveFleetEdgeByInstanceId(instanceId: string): FleetEdge | null {
  const trimmed = instanceId.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeFleetId(trimmed);
  for (const edge of listFleetEdges()) {
    if (edge.instanceId === trimmed) {
      return edge;
    }
    if (edge.id === normalized) {
      return edge;
    }
  }
  return null;
}
