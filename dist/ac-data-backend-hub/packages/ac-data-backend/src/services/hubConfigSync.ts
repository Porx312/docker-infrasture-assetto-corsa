import type { RedisClientType } from 'redis';

import { publishConfigSnapshotToRedis } from '@projectd/ac-data-shared/services/config/configSnapshotRedis.js';
import type { WorkerConfigSnapshotResult } from '@projectd/ac-data-shared/services/hud/workerConvexQueries.js';
import { createRedisClient, isRedisConfigured } from './redisClient.js';

let hubRedis: RedisClientType | null = null;

async function getHubRedisClient(): Promise<RedisClientType | null> {
  if (!isRedisConfigured()) {
    return null;
  }
  if (hubRedis?.isOpen) {
    return hubRedis;
  }
  hubRedis = createRedisClient('hub-config-sync');
  await hubRedis.connect();
  return hubRedis;
}

/** Publish snapshot to hub Redis when no fleet edge matches instanceId. */
export async function publishConfigSnapshotToHubRedis(
  snapshot: WorkerConfigSnapshotResult,
): Promise<void> {
  const client = await getHubRedisClient();
  if (!client) {
    throw new Error('REDIS_HOST missing on hub for config publish');
  }
  await publishConfigSnapshotToRedis(client, snapshot);
  console.log(
    `[hub-config-sync] published instance=${snapshot.instanceId} version=${snapshot.version} servers=${snapshot.totalServers}`,
  );
}
