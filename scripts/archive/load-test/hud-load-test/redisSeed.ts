import { createClient, type RedisClientType } from 'redis';

import { steamIdForClient } from './config.js';

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export function battleServerKey(instanceId: string, displayServerName: string): string {
  return `${normalizeKeyPart(instanceId)}_${normalizeKeyPart(displayServerName)}`;
}

export function battleRedisKey(serverKey: string, steamId: string): string {
  return `ac:hud:battle:${serverKey}:${steamId}`;
}

export function battleVersionRedisKey(serverKey: string, steamId: string): string {
  return `ac:hud:ver:battle:${serverKey}:${steamId}`;
}

export function presenceRedisKey(steamId: string): string {
  return `ac:hud:presence:${steamId}`;
}

export function sessionRedisKey(steamId: string): string {
  return `ac:hud:session:${steamId}`;
}

export type RedisEnv = {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
};

export function redisEnvFromProcess(): RedisEnv {
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    tls: (process.env.REDIS_SSL ?? 'false').toLowerCase() === 'true',
  };
}

export async function createRedisClient(): Promise<RedisClientType> {
  const env = redisEnvFromProcess();
  const url =
    process.env.REDIS_URL?.trim() ||
    (env.password
      ? `redis${env.tls ? 's' : ''}://:${encodeURIComponent(env.password)}@${env.host}:${env.port}`
      : `redis${env.tls ? 's' : ''}://${env.host}:${env.port}`);

  const client = createClient({ url });
  client.on('error', (err) => {
    console.error('[hud-load-test] redis error:', err.message);
  });
  await client.connect();
  return client;
}

export type SeedProfile = {
  name: string;
  tier: number;
  elo: number;
  car_id: string;
  car_name: string;
};

export async function seedPresence(
  redis: RedisClientType,
  steamId: string,
  serverName: string,
  track: string,
  trackConfig: string,
  carModel: string,
  ttlSec: number,
): Promise<void> {
  const record = {
    serverName,
    track,
    trackConfig,
    carModel,
    updatedAt: Date.now(),
  };
  await redis.set(presenceRedisKey(steamId), JSON.stringify(record), { EX: ttlSec });
}

export async function seedSessionCache(
  redis: RedisClientType,
  steamId: string,
  serverName: string,
  track: string,
  trackConfig: string,
  profile: SeedProfile,
  version: string,
  ttlSec: number,
): Promise<void> {
  const session = {
    ok: true,
    version,
    context: {
      server_id: 'loadtest',
      server_name: serverName,
      track_id: track,
      track_name: track,
      layout_id: trackConfig,
      layout_name: trackConfig,
      car_id: profile.car_id,
      car_name: profile.car_name,
      player_steam_id: steamId,
    },
    profile: {
      name: profile.name,
      rank: 10,
      tier: profile.tier,
      best_lap_ms: 280_000,
      car_name: profile.car_name,
      car_id: profile.car_id,
      steam_id: steamId,
      elo: profile.elo,
      rivals: { above: null, below: null },
    },
  };
  await redis.set(sessionRedisKey(steamId), JSON.stringify(session), { EX: ttlSec });
}

export function defaultProfileForClient(index: number, carModel: string): SeedProfile {
  return {
    name: `LoadTest${index + 1}`,
    tier: 5,
    elo: 1500,
    car_id: carModel,
    car_name: carModel,
  };
}

export async function seedAllClients(
  redis: RedisClientType,
  clientCount: number,
  opts: {
    serverName: string;
    track: string;
    trackConfig: string;
    carModel: string;
    ttlSec: number;
    battleId: string;
  },
): Promise<string[]> {
  const steamIds: string[] = [];
  for (let i = 0; i < clientCount; i += 1) {
    const steamId = steamIdForClient(i);
    steamIds.push(steamId);
    const profile = defaultProfileForClient(i, opts.carModel);
    await seedPresence(
      redis,
      steamId,
      opts.serverName,
      opts.track,
      opts.trackConfig,
      opts.carModel,
      opts.ttlSec,
    );
    await seedSessionCache(
      redis,
      steamId,
      opts.serverName,
      opts.track,
      opts.trackConfig,
      profile,
      `loadtest:${opts.battleId}`,
      opts.ttlSec,
    );
  }
  return steamIds;
}

export async function moveClientsToServer(
  redis: RedisClientType,
  steamIds: string[],
  serverName: string,
  track: string,
  trackConfig: string,
  carModel: string,
  ttlSec: number,
): Promise<void> {
  for (const steamId of steamIds) {
    await seedPresence(redis, steamId, serverName, track, trackConfig, carModel, ttlSec);
  }
}

export async function pingRedisMs(redis: RedisClientType): Promise<number> {
  const start = performance.now();
  await redis.ping();
  return performance.now() - start;
}

export async function redisConnectedClients(redis: RedisClientType): Promise<number | null> {
  try {
    const info = await redis.info('clients');
    const match = info.match(/connected_clients:(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export async function writeBattleSnapshot(
  redis: RedisClientType,
  serverKey: string,
  steamId: string,
  snapshot: Record<string, unknown>,
  battleTtlSec: number,
  verTtlSec: number,
): Promise<void> {
  const payload = JSON.stringify(snapshot);
  const version = String(snapshot.version ?? '');
  const cacheKey = `${serverKey}:${steamId}`;
  await redis.set(battleRedisKey(serverKey, steamId), payload, { EX: battleTtlSec });
  await redis.set(battleVersionRedisKey(serverKey, steamId), version, { EX: verTtlSec });
  await redis.publish(
    'ac:hud:updates',
    JSON.stringify({ scopeKey: `battle:${cacheKey}`, version, ts: Date.now() }),
  );
}

export async function clearBattleForClient(
  redis: RedisClientType,
  serverKey: string,
  steamId: string,
): Promise<void> {
  await redis.del(battleRedisKey(serverKey, steamId));
  await redis.del(battleVersionRedisKey(serverKey, steamId));
}
