export type HealthStatus = 'PASS' | 'WARNING' | 'FAIL';

export type ScenarioName = 'idle' | 'active' | 'score' | 'lifecycle' | 'server-change';

export type LoadTestThresholds = {
  maxErrorRate: number;
  maxP95LatencyMs: number;
  maxP99LatencyMs: number;
  maxStaleSnapshotRate: number;
  maxRevisionRegressionRate: number;
  maxSyncDivergenceRate: number;
  maxRedisLatencyMs: number;
  maxCpuPercent: number;
  maxMemoryMb: number;
  /** Steady-state Convex calls per client per minute (full+version); detect request storm */
  maxConvexCallsPerClientPerMin: number;
};

export type LatencySample = {
  ms: number;
  ok: boolean;
  status: number;
  sections: 'full' | 'battle';
};

export type HudClientSnapshotState = {
  battleId: string | null;
  state: string;
  version: string | null;
  revision: number | null;
  p1Score: number | null;
  p2Score: number | null;
  pointsLogLen: number;
  receivedAt: number;
};

export type HudClientMetrics = {
  steamId: string;
  serverName: string;
  successfulSnapshots: number;
  failedSnapshots: number;
  timeouts: number;
  connectionFailures: number;
  reconnects: number;
  missedSnapshots: number;
  staleSnapshots: number;
  outOfOrderSnapshots: number;
  revisionRegressions: number;
  fullSnapshots: number;
  battleSnapshots: number;
  waitingMs: number;
  lastSnapshot: HudClientSnapshotState | null;
  latenciesMs: number[];
};

export type HostMetricsSample = {
  ts: number;
  cpuPercent: number | null;
  memoryMb: number | null;
  redisLatencyMs: number | null;
  redisConnectedClients: number | null;
};

export type ConvexStatsSnapshot = {
  ts: number;
  fetchHudSession: number;
  fetchHudVersion: number;
  total: number;
  sseConnected: number;
};

export type LevelResult = {
  clients: number;
  durationSec: number;
  scenario: string;
  status: HealthStatus;
  rps: number;
  rpm: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorRate: number;
  timeoutCount: number;
  redisLatencyMs: number | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  convexSessionCalls: number;
  convexVersionCalls: number;
  convexCallsPerClientPerMin: number;
  syncDivergenceRate: number;
  staleRate: number;
  revisionRegressionRate: number;
  stuckClients: number;
  notes: string[];
};

export type ProgressiveReport = {
  target: string;
  startedAt: string;
  finishedAt: string;
  levels: LevelResult[];
  safeCapacity: number | null;
  degradationPoint: number | null;
  failurePoint: number | null;
  firstBottleneck: string | null;
};
