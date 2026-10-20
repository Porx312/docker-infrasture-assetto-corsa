import { stripCspTrackPrefix } from '../mods/cspTrack.js';
import { normalizeHudServerName } from './hud/hudQueryNormalize.js';

export type IngestServerNameResolver = (
  serverName: string | undefined,
) => string | undefined;

function defaultResolveIngestServerName(
  serverName: string | undefined,
): string | undefined {
  if (serverName === undefined) {
    return undefined;
  }
  const trimmed = serverName.trim();
  if (trimmed === '' || trimmed === '__config__') {
    return trimmed;
  }
  return normalizeHudServerName(trimmed) || undefined;
}

/** Normalize track fields for Convex battle_tracks lookup (strip CSP TRACK= wrapper). */
export function normalizeIngestTrackFields(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) };
  if (typeof out.trackName === 'string' && out.trackName.trim()) {
    out.trackName = stripCspTrackPrefix(out.trackName);
  }
  if (typeof out.track === 'string' && out.track.trim()) {
    out.track = stripCspTrackPrefix(out.track);
  }
  return out;
}

export function buildIngestEvent(
  payload: Record<string, unknown>,
  resolveServerName: IngestServerNameResolver = defaultResolveIngestServerName,
) {
  const event = String(payload.event || '');
  const data = payload.data as Record<string, unknown> | undefined;
  const rawServerName = typeof payload.serverName === 'string' ? payload.serverName : undefined;
  const serverName = resolveServerName(rawServerName);

  if (
    rawServerName &&
    serverName &&
    rawServerName !== serverName &&
    rawServerName !== '__config__'
  ) {
    console.log(
      `[redis-bridge] ingest serverName ${rawServerName} -> ${serverName} event=${event}`,
    );
  }

  const normalizedData = normalizeIngestTrackFields(data);

  return {
    eventType: event,
    serverName,
    data: {
      ...normalizedData,
      _meta: {
        eventId: payload.eventId,
        schemaVersion: payload.schemaVersion,
        event,
        instanceId: payload.instanceId,
        serverName,
        ts: payload.ts,
      },
    },
  };
}
