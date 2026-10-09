import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/loadEnv.js';
import { isConvexConfigured } from './convexClient.js';
import { getHudRedisClient, isHudRedisConfigured } from './hud/hudRedis.js';

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'ac:events';
const REDIS_CONSUMER_GROUP = process.env.REDIS_CONSUMER_GROUP || 'ac-data-consumers';
const AC_INSTANCE_ID = process.env.AC_INSTANCE_ID || 'default';

export type AcDataHealth = {
  ok: boolean;
  version: string;
  builtAt: string | null;
  uptimeSec: number;
  instanceId: string;
  redis: {
    configured: boolean;
    ok: boolean;
    streamLength: number | null;
    pendingEvents: number | null;
    message?: string;
  };
  convex: {
    configured: boolean;
    ingestSecretSet: boolean;
    workerSecretSet: boolean;
  };
};

function readPackageVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
  ];
  for (const pkgPath of candidates) {
    try {
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return 'unknown';
}

function readBuildInfo(): string | null {
  const candidates = [
    path.join(process.cwd(), 'dist', 'build-info.json'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json'),
  ];
  for (const infoPath of candidates) {
    try {
      if (!fs.existsSync(infoPath)) continue;
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')) as { builtAt?: string };
      return info.builtAt ?? null;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function getAcDataHealth(): Promise<AcDataHealth> {
  const redisConfigured = isHudRedisConfigured();
  let redisOk = false;
  let streamLength: number | null = null;
  let pendingEvents: number | null = null;
  let redisMessage: string | undefined;

  if (redisConfigured) {
    try {
      const client = await getHudRedisClient();
      const pong = await client.ping();
      redisOk = pong === 'PONG';
      streamLength = await client.xLen(REDIS_STREAM_KEY);
      try {
        const pending = await client.xPending(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP);
        pendingEvents =
          typeof pending === 'object' && pending !== null && 'count' in pending
            ? Number((pending as { count: number }).count)
            : null;
        const warnAt = Number(process.env.REDIS_STREAM_PENDING_WARN || 500);
        if (
          pendingEvents !== null &&
          warnAt > 0 &&
          pendingEvents >= warnAt
        ) {
          console.warn(
            `[health] Redis XPENDING high stream=${REDIS_STREAM_KEY} group=${REDIS_CONSUMER_GROUP} pending=${pendingEvents} (warn>=${warnAt})`,
          );
        }
      } catch {
        pendingEvents = null;
      }
    } catch (err) {
      redisMessage = err instanceof Error ? err.message : 'Redis check failed';
    }
  }

  const convexConfigured = isConvexConfigured();
  const ingestSecretSet = Boolean((process.env.CONVEX_INGEST_SECRET || '').trim());
  const workerSecretSet = Boolean((process.env.CONVEX_WORKER_SECRET || '').trim());

  const ok = redisConfigured ? redisOk : true;

  return {
    ok,
    version: readPackageVersion(),
    builtAt: readBuildInfo(),
    uptimeSec: Math.floor(process.uptime()),
    instanceId: AC_INSTANCE_ID,
    redis: {
      configured: redisConfigured,
      ok: redisOk,
      streamLength,
      pendingEvents,
      ...(redisMessage ? { message: redisMessage } : {}),
    },
    convex: {
      configured: convexConfigured,
      ingestSecretSet,
      workerSecretSet,
    },
  };
}
