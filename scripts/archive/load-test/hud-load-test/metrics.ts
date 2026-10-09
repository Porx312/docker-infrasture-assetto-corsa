import { percentile } from './config.js';
import type { HealthStatus, HostMetricsSample, LatencySample, LoadTestThresholds } from './types.js';

export class MetricsCollector {
  private latencies: LatencySample[] = [];
  private hostSamples: HostMetricsSample[] = [];
  private errors = 0;
  private timeouts = 0;
  private connectionFailures = 0;
  private totalRequests = 0;
  private startedAt = Date.now();

  recordRequest(sample: LatencySample): void {
    this.totalRequests += 1;
    this.latencies.push(sample);
    if (!sample.ok) {
      this.errors += 1;
    }
  }

  battleErrorRate(): number {
    const battle = this.latencies.filter((s) => s.sections === 'battle');
    if (battle.length === 0) {
      return 0;
    }
    return battle.filter((s) => !s.ok).length / battle.length;
  }

  recordTimeout(): void {
    this.timeouts += 1;
    this.errors += 1;
  }

  recordConnectionFailure(): void {
    this.connectionFailures += 1;
    this.errors += 1;
  }

  recordHostSample(sample: HostMetricsSample): void {
    this.hostSamples.push(sample);
  }

  get elapsedSec(): number {
    return Math.max(1, (Date.now() - this.startedAt) / 1000);
  }

  get requestCount(): number {
    return this.totalRequests;
  }

  get errorCount(): number {
    return this.errors;
  }

  latencyStats(): { p50: number; p95: number; p99: number; max: number } {
    const ok = this.latencies.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
    return {
      p50: percentile(ok, 50),
      p95: percentile(ok, 95),
      p99: percentile(ok, 99),
      max: ok.length > 0 ? ok[ok.length - 1]! : 0,
    };
  }

  rps(): number {
    return this.totalRequests / this.elapsedSec;
  }

  rpm(): number {
    return this.rps() * 60;
  }

  errorRate(): number {
    if (this.totalRequests === 0) {
      return 0;
    }
    return this.errors / this.totalRequests;
  }

  get timeoutCount(): number {
    return this.timeouts;
  }

  avgHostMetric(key: keyof Omit<HostMetricsSample, 'ts'>): number | null {
    const values = this.hostSamples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) {
      return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  maxHostMetric(key: keyof Omit<HostMetricsSample, 'ts'>): number | null {
    const values = this.hostSamples
      .map((s) => s[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) {
      return null;
    }
    return Math.max(...values);
  }

  evaluateHealth(input: {
    thresholds: LoadTestThresholds;
    syncDivergenceRate: number;
    staleRate: number;
    revisionRegressionRate: number;
    stuckClients: number;
    convexCallsPerClientPerMin: number;
  }): { status: HealthStatus; notes: string[] } {
    const notes: string[] = [];
    const lat = this.latencyStats();
    const errRate = this.battleErrorRate();
    const overallErrRate = this.errorRate();
    let status: HealthStatus = 'PASS';

    const warn = (msg: string) => {
      notes.push(msg);
      if (status === 'PASS') {
        status = 'WARNING';
      }
    };
    const fail = (msg: string) => {
      notes.push(msg);
      status = 'FAIL';
    };

    if (errRate >= input.thresholds.maxErrorRate) {
      fail(`Battle snapshot error rate ${(errRate * 100).toFixed(2)}% >= ${(input.thresholds.maxErrorRate * 100).toFixed(2)}%`);
    } else if (overallErrRate > errRate && overallErrRate >= input.thresholds.maxErrorRate) {
      warn(`Overall HTTP error rate ${(overallErrRate * 100).toFixed(2)}% (includes Convex full probes)`);
    }
    if (this.timeouts > 0 && this.timeouts / Math.max(1, this.totalRequests) > 0.005) {
      fail(`Timeout storm: ${this.timeouts} timeouts / ${this.totalRequests} requests`);
    }
    if (lat.p95 > input.thresholds.maxP95LatencyMs) {
      fail(`p95 latency ${lat.p95.toFixed(0)}ms > ${input.thresholds.maxP95LatencyMs}ms`);
    } else if (lat.p95 > input.thresholds.maxP95LatencyMs * 0.75) {
      warn(`p95 latency elevated: ${lat.p95.toFixed(0)}ms`);
    }
    if (lat.p99 > input.thresholds.maxP99LatencyMs) {
      warn(`p99 latency ${lat.p99.toFixed(0)}ms > ${input.thresholds.maxP99LatencyMs}ms`);
    }

    const avgRedis = this.avgHostMetric('redisLatencyMs');
    if (avgRedis !== null && avgRedis > input.thresholds.maxRedisLatencyMs) {
      fail(`Redis latency avg ${avgRedis.toFixed(1)}ms > ${input.thresholds.maxRedisLatencyMs}ms`);
    }

    const maxCpu = this.maxHostMetric('cpuPercent');
    if (maxCpu !== null && maxCpu > input.thresholds.maxCpuPercent) {
      fail(`CPU peak ${maxCpu.toFixed(1)}% > ${input.thresholds.maxCpuPercent}%`);
    }

    const maxMem = this.maxHostMetric('memoryMb');
    if (
      input.thresholds.maxMemoryMb > 0 &&
      maxMem !== null &&
      maxMem > input.thresholds.maxMemoryMb
    ) {
      fail(`Memory peak ${maxMem.toFixed(0)}MB > ${input.thresholds.maxMemoryMb}MB`);
    }

    if (input.syncDivergenceRate > input.thresholds.maxSyncDivergenceRate) {
      fail(`Sync divergence ${(input.syncDivergenceRate * 100).toFixed(2)}%`);
    }
    if (input.staleRate > input.thresholds.maxStaleSnapshotRate) {
      fail(`Stale snapshot rate ${(input.staleRate * 100).toFixed(2)}%`);
    }
    if (input.revisionRegressionRate > input.thresholds.maxRevisionRegressionRate) {
      fail(`Revision regression rate ${(input.revisionRegressionRate * 100).toFixed(2)}%`);
    }
    if (input.stuckClients > 0) {
      fail(`${input.stuckClients} clients stuck (no snapshot > 30s)`);
    }

    if (input.convexCallsPerClientPerMin > input.thresholds.maxConvexCallsPerClientPerMin) {
      fail(
        `Convex call volume ${input.convexCallsPerClientPerMin.toFixed(1)}/client/min ` +
          `(request storm?) > ${input.thresholds.maxConvexCallsPerClientPerMin}`,
      );
    }

    return { status, notes };
  }
}
