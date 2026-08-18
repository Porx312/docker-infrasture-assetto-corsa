import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { RedisClientType } from 'redis';

import { pingRedisMs, redisConnectedClients } from './redisSeed.js';
import type { HostMetricsSample } from './types.js';

let lastCpuIdle = 0;
let lastCpuTotal = 0;

function readProcStat(): { idle: number; total: number } | null {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0] ?? '';
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    if (parts.length < 4) {
      return null;
    }
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

export function sampleCpuPercent(): number | null {
  const cur = readProcStat();
  if (!cur) {
    return null;
  }
  if (lastCpuTotal === 0) {
    lastCpuIdle = cur.idle;
    lastCpuTotal = cur.total;
    return null;
  }
  const idleDelta = cur.idle - lastCpuIdle;
  const totalDelta = cur.total - lastCpuTotal;
  lastCpuIdle = cur.idle;
  lastCpuTotal = cur.total;
  if (totalDelta <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

export function sampleMemoryMb(): number | null {
  try {
    const txt = readFileSync('/proc/self/status', 'utf8');
    const match = txt.match(/^VmRSS:\s+(\d+)\s+kB/m);
    if (!match) {
      return null;
    }
    return Number(match[1]) / 1024;
  } catch {
    return null;
  }
}

/** Sample ac-data process RSS if pid file or pgrep available via /proc scan. */
export function sampleAcDataMemoryMb(): number | null {
  try {
    const pid = execSync("pgrep -f 'tsx src/index|node dist/index' | head -1", {
      encoding: 'utf8',
    }).trim();
    if (!pid) {
      return sampleMemoryMb();
    }
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    if (!match) {
      return null;
    }
    return Number(match[1]) / 1024;
  } catch {
    return sampleMemoryMb();
  }
}

export async function sampleHostMetrics(redis: RedisClientType): Promise<HostMetricsSample> {
  const [redisLatencyMs, redisClients] = await Promise.all([
    pingRedisMs(redis).catch(() => null),
    redisConnectedClients(redis),
  ]);

  return {
    ts: Date.now(),
    cpuPercent: sampleCpuPercent(),
    memoryMb: sampleAcDataMemoryMb(),
    redisLatencyMs,
    redisConnectedClients: redisClients,
  };
}

export type ConvexStatsDelta = {
  fetchHudSession: number;
  fetchHudVersion: number;
  total: number;
  sseConnected: number;
};

export async function fetchConvexStats(
  baseUrl: string,
  workerSecret: string,
): Promise<ConvexStatsDelta | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/hud/worker/convex-query-stats`, {
      headers: { 'X-Worker-Secret': workerSecret },
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      queries?: Record<string, number>;
      total?: number;
      wsConnected?: number;
      streamConnected?: number;
      sseConnected?: number;
    };
    return {
      fetchHudSession: body.queries?.fetchHudSession ?? 0,
      fetchHudVersion: body.queries?.fetchHudVersion ?? 0,
      total: body.total ?? 0,
      wsConnected: body.wsConnected ?? body.streamConnected ?? body.sseConnected ?? 0,
    };
  } catch {
    return null;
  }
}
