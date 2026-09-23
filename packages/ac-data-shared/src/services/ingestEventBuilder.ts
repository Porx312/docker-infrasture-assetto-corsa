import { normalizeHudServerName } from './hud/hudQueryNormalize.js';

function resolveIngestServerNameForBackend(serverName: string | undefined): string | undefined {
  if (serverName === undefined) {
    return undefined;
  }
  const trimmed = serverName.trim();
  if (trimmed === '' || trimmed === '__config__') {
    return trimmed;
  }
  return normalizeHudServerName(trimmed) || undefined;
}

export function buildIngestEvent(payload: Record<string, unknown>) {
  const event = String(payload.event || '');
  const data = payload.data as Record<string, unknown> | undefined;
  const rawServerName = typeof payload.serverName === 'string' ? payload.serverName : undefined;
  const serverName = resolveIngestServerNameForBackend(rawServerName);

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

  return {
    eventType: event,
    serverName,
    data: {
      ...(data ?? {}),
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
