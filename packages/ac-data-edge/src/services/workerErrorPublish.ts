import crypto from 'node:crypto';
import { getHudRedisClient, isHudRedisConfigured } from './hud/hudRedis.js';

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'ac:events';

/** Publish admin-visible worker error onto Redis stream (hub Activity UI). */
export async function publishWorkerErrorEvent(details: {
  error: string;
  failed: number;
  eventTypes: string[];
}): Promise<void> {
  if (!isHudRedisConfigured()) return;

  const client = await getHudRedisClient();
  const eventId = crypto.randomUUID();
  const ts = Date.now();
  const instanceId = process.env.AC_INSTANCE_ID || 'default';
  const envelope = {
    eventId,
    schemaVersion: '1',
    event: 'worker_error',
    serverName: 'worker',
    instanceId,
    ts,
    data: {
      error: details.error,
      failed: details.failed,
      eventTypes: details.eventTypes,
    },
  };

  await client.xAdd(
    REDIS_STREAM_KEY,
    '*',
    {
      event: 'worker_error',
      eventId,
      schemaVersion: '1',
      instanceId,
      serverName: 'worker',
      ts: String(ts),
      payload: JSON.stringify(envelope),
    },
    {
      TRIM: {
        strategy: 'MAXLEN',
        strategyModifier: '~',
        threshold: Number(process.env.REDIS_STREAM_MAXLEN || 200_000),
      },
    },
  );
}
