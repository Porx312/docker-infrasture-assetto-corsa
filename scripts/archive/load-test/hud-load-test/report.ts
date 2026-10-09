import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { LevelResult, ProgressiveReport } from './types.js';

export function formatLevelRow(level: LevelResult): string {
  return [
    String(level.clients).padStart(7),
    level.rps.toFixed(1).padStart(6),
    `${level.p95Ms.toFixed(0)}ms`.padStart(7),
    `${(level.errorRate * 100).toFixed(2)}%`.padStart(7),
    level.redisLatencyMs !== null ? `${level.redisLatencyMs.toFixed(1)}ms` : 'n/a',
    level.cpuPercent !== null ? `${level.cpuPercent.toFixed(0)}%` : 'n/a',
    level.memoryMb !== null ? `${level.memoryMb.toFixed(0)}MB` : 'n/a',
    `${level.convexCallsPerClientPerMin.toFixed(1)}/m`.padStart(8),
    level.status.padStart(7),
  ].join(' | ');
}

export function printReport(report: ProgressiveReport): void {
  console.log('');
  console.log('HUD LOAD TEST');
  console.log(`Target: ${report.target}`);
  console.log(`Started: ${report.startedAt}`);
  console.log(`Finished: ${report.finishedAt}`);
  console.log('');
  console.log(
    'Clients | RPS    | p95     | Errors  | Redis      | CPU   | Memory | Convex   | Sync',
  );
  console.log(
    '--------+--------+---------+---------+------------+-------+--------+----------+-------',
  );

  for (const level of report.levels) {
    console.log(formatLevelRow(level));
    if (level.notes.length > 0) {
      for (const note of level.notes) {
        console.log(`         └─ ${note}`);
      }
    }
  }

  console.log('');
  console.log(`Safe capacity: ${report.safeCapacity ?? 'unknown'}`);
  console.log(`Degradation begins: ${report.degradationPoint ?? 'not observed'}`);
  console.log(`Failure point: ${report.failurePoint ?? 'not reached'}`);
  if (report.firstBottleneck) {
    console.log(`First bottleneck: ${report.firstBottleneck}`);
  }
  console.log('');
}

export function writeReportFiles(report: ProgressiveReport, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `hud-load-test-${Date.now()}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const mdPath = jsonPath.replace(/\.json$/, '.md');
  const md = [
    '# HUD Load Test Report',
    '',
    `- Target: ${report.target}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '| Clients | RPS | p95 | Errors | Redis | CPU | Memory | Convex/client/min | Status |',
    '|--------:|----:|----:|-------:|------:|----:|-------:|------------------:|:------:|',
    ...report.levels.map(
      (l) =>
        `| ${l.clients} | ${l.rps.toFixed(1)} | ${l.p95Ms.toFixed(0)}ms | ${(l.errorRate * 100).toFixed(2)}% | ` +
        `${l.redisLatencyMs?.toFixed(1) ?? 'n/a'}ms | ${l.cpuPercent?.toFixed(0) ?? 'n/a'}% | ` +
        `${l.memoryMb?.toFixed(0) ?? 'n/a'}MB | ${l.convexCallsPerClientPerMin.toFixed(1)} | ${l.status} |`,
    ),
    '',
    `- **Safe capacity:** ${report.safeCapacity ?? 'unknown'}`,
    `- **Degradation point:** ${report.degradationPoint ?? 'not observed'}`,
    `- **Failure point:** ${report.failurePoint ?? 'not reached'}`,
    `- **First bottleneck:** ${report.firstBottleneck ?? 'unknown'}`,
    '',
  ].join('\n');
  writeFileSync(mdPath, md);
  console.log(`Report written: ${jsonPath}`);
  console.log(`Report written: ${mdPath}`);
}

export function deriveCapacityPoints(levels: LevelResult[]): {
  safeCapacity: number | null;
  degradationPoint: number | null;
  failurePoint: number | null;
  firstBottleneck: string | null;
} {
  let safeCapacity: number | null = null;
  let degradationPoint: number | null = null;
  let failurePoint: number | null = null;
  let firstBottleneck: string | null = null;

  for (const level of levels) {
    if (level.status === 'PASS') {
      safeCapacity = level.clients;
    } else if (level.status === 'WARNING' && degradationPoint === null) {
      degradationPoint = level.clients;
      firstBottleneck ??= level.notes[0] ?? 'elevated latency or warnings';
    } else if (level.status === 'FAIL') {
      failurePoint ??= level.clients;
      firstBottleneck ??= level.notes[0] ?? 'health threshold exceeded';
      break;
    }
  }

  return { safeCapacity, degradationPoint, failurePoint, firstBottleneck };
}
