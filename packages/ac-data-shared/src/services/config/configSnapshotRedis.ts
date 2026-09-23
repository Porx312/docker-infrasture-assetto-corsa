import type { RedisClientType } from 'redis';
import type { WorkerConfigSnapshotResult } from '../hud/workerConvexQueries.js';

const REDIS_CONFIG_STREAM_KEY = process.env.REDIS_CONFIG_STREAM_KEY || 'ac:config';

export async function publishConfigSnapshotToRedis(
  client: RedisClientType,
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  const now = Date.now();
  const payload = {
    eventId: `cfg-${snapshot.instanceId}-${snapshot.version}-${now}`,
    schemaVersion: '1',
    event: 'server_config_snapshot',
    serverName: '__config__',
    instanceId: snapshot.instanceId,
    ts: now,
    data: {
      instanceId: snapshot.instanceId,
      version: snapshot.version,
      includeInactive: snapshot.includeInactive,
      totalServers: snapshot.totalServers,
      maxUpdatedAt: snapshot.maxUpdatedAt,
      servers: snapshot.servers,
    },
  };
  await client.xAdd(
    REDIS_CONFIG_STREAM_KEY,
    '*',
    {
      event: payload.event,
      eventId: payload.eventId,
      schemaVersion: payload.schemaVersion,
      instanceId: payload.instanceId,
      serverName: payload.serverName,
      ts: String(payload.ts),
      payload: JSON.stringify(payload),
    },
    {
      TRIM: {
        strategy: 'MAXLEN',
        strategyModifier: '~',
        threshold: 200000,
      },
    },
  );
}
