import { resolveIngestServerName } from './resolveIngestServerName.js';

export function buildIngestEvent(payload: Record<string, unknown>) {
  const event = String(payload.event || '');
  const data = payload.data as Record<string, unknown> | undefined;
  const rawServerName = typeof payload.serverName === 'string' ? payload.serverName : undefined;
  const serverName = resolveIngestServerName(rawServerName);

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
