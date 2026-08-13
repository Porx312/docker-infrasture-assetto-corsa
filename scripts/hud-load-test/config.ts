import type { LoadTestThresholds, ScenarioName } from './types.js';

/** Poll intervals mirror ProjectD-HUD/common/config.lua */
export const HUD_POLL_INTERVALS = {
  defaultSec: 5,
  battleWaitSec: 2,
  battleActiveSec: 0.5,
  prepSec: 0.3,
  sseBattleBackupSec: 1.0,
} as const;

export const PROGRESSIVE_LEVELS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export const DEFAULT_THRESHOLDS: LoadTestThresholds = {
  maxErrorRate: Number(process.env.HUD_LOAD_TEST_MAX_ERROR_RATE ?? 0.01),
  maxP95LatencyMs: Number(process.env.HUD_LOAD_TEST_MAX_P95_MS ?? 2000),
  maxP99LatencyMs: Number(process.env.HUD_LOAD_TEST_MAX_P99_MS ?? 5000),
  maxStaleSnapshotRate: Number(process.env.HUD_LOAD_TEST_MAX_STALE_RATE ?? 0.05),
  maxRevisionRegressionRate: Number(process.env.HUD_LOAD_TEST_MAX_REVISION_REGRESSION ?? 0.01),
  maxSyncDivergenceRate: Number(process.env.HUD_LOAD_TEST_MAX_SYNC_DIVERGENCE ?? 0.02),
  maxRedisLatencyMs: Number(process.env.HUD_LOAD_TEST_MAX_REDIS_MS ?? 50),
  maxCpuPercent: Number(process.env.HUD_LOAD_TEST_MAX_CPU ?? 85),
  maxMemoryMb: Number(process.env.HUD_LOAD_TEST_MAX_MEMORY_MB ?? 0), // 0 = disabled
  maxConvexCallsPerClientPerMin: Number(
    process.env.HUD_LOAD_TEST_MAX_CONVEX_CALLS_PER_CLIENT_MIN ?? 6,
  ),
};

export type RunConfig = {
  baseUrl: string;
  apiKey: string;
  workerSecret: string;
  redisUrl: string;
  instanceId: string;
  serverName: string;
  serverNameB: string;
  clients: number;
  durationSec: number;
  rampSec: number;
  scenario: ScenarioName;
  runServerChange: boolean;
  serverChangePct: number;
  serverChangeAtSec: number;
  enableSse: boolean;
  sseFraction: number;
  pollIntervalOverrideSec: number | null;
  thresholds: LoadTestThresholds;
  outputDir: string;
  track: string;
  trackConfig: string;
  carModel: string;
  battleTtlSec: number;
  dryRun: boolean;
  confirm: boolean;
  startWithCachedBundle: boolean;
  convexProbeClients: number;
};

export function steamIdForClient(index: number): string {
  // Valid-looking 17-digit Steam IDs for load-test range.
  const base = 76561199000000000n;
  return String(base + BigInt(index + 1));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}
