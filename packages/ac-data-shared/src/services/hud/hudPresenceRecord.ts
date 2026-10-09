/**
 * Shared player presence JSON stored at `ac:hud:presence:{steamId}`.
 * Hub routing, Control API live roster, and edge writers must use the same shape.
 */

export type HudPresenceRecord = {
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
  updatedAt: number;
  name?: string;
  instanceId?: string;
  folderSlug?: string;
};

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Parse Redis JSON into a typed presence record, or null if invalid. */
export function parseHudPresenceRecord(raw: unknown): HudPresenceRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const serverName = optionalTrimmedString(row.serverName);
  if (!serverName) {
    return null;
  }
  const track = typeof row.track === 'string' ? row.track : '';
  const trackConfig = typeof row.trackConfig === 'string' ? row.trackConfig : '';
  const carModel = typeof row.carModel === 'string' ? row.carModel : '';
  const updatedAt =
    typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
      ? row.updatedAt
      : Date.now();

  const out: HudPresenceRecord = {
    serverName,
    track,
    trackConfig,
    carModel,
    updatedAt,
  };
  const name = optionalTrimmedString(row.name);
  if (name) out.name = name;
  const instanceId = optionalTrimmedString(row.instanceId);
  if (instanceId) out.instanceId = instanceId;
  const folderSlug = optionalTrimmedString(row.folderSlug);
  if (folderSlug) out.folderSlug = folderSlug;
  return out;
}

export function parseHudPresenceRecordJson(raw: string): HudPresenceRecord | null {
  try {
    return parseHudPresenceRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function serializeHudPresenceRecord(record: HudPresenceRecord): string {
  return JSON.stringify(record);
}
