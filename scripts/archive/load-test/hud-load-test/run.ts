#!/usr/bin/env npx tsx
/**
 * ProjectD Battle HUD load test — simulates real overlay snapshot polling behavior.
 *
 * Usage: see scripts/load-test-hud.sh
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BattleSimulator } from './battleSimulator.js';
import {
  DEFAULT_THRESHOLDS,
  PROGRESSIVE_LEVELS,
  type RunConfig,
  steamIdForClient,
} from './config.js';
import { fetchConvexStats, sampleHostMetrics } from './hostMetrics.js';
import { HudSimClient } from './hudClient.js';
import { MetricsCollector } from './metrics.js';
import { deriveCapacityPoints, printReport, writeReportFiles } from './report.js';
import {
  createRedisClient,
  moveClientsToServer,
  seedAllClients,
} from './redisSeed.js';
import { assertSafeLoadTestTarget, requireLoadTestConfirmation } from './safety.js';
import { evaluateSync } from './syncValidator.js';
import type { LevelResult, ProgressiveReport, ScenarioName } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

type CliArgs = {
  clients: number;
  durationSec: number;
  rampSec: number;
  serverName: string;
  serverNameB: string;
  scenario: ScenarioName;
  runServerChange: boolean;
  serverChangePct: number;
  serverChangeAtSec: number;
  baseUrl: string;
  profile: boolean;
  progressive: boolean;
  confirm: boolean;
  enableSse: boolean;
  sseFraction: number;
  pollIntervalOverrideSec: number | null;
  outputDir: string;
  dryRun: boolean;
  startWithCachedBundle: boolean;
  convexProbeClients: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    clients: 10,
    durationSec: Number(process.env.HUD_LOAD_TEST_DURATION_SEC ?? 600),
    rampSec: Number(process.env.HUD_LOAD_TEST_RAMP_SEC ?? 30),
    serverName: process.env.HUD_BATTLE_SERVER_NAME ?? 'Gunsai Testing',
    serverNameB: process.env.HUD_LOAD_TEST_SERVER_B ?? 'Gunsai Testing B',
    scenario: (process.env.HUD_LOAD_TEST_SCENARIO ?? 'active') as ScenarioName,
    runServerChange: false,
    serverChangePct: 20,
    serverChangeAtSec: 120,
    baseUrl: process.env.HUD_LOAD_TEST_BASE_URL ?? process.env.AC_DATA_BASE_URL ?? 'http://127.0.0.1:3000',
    profile: false,
    progressive: false,
    confirm: false,
    enableSse: false,
    sseFraction: Number(process.env.HUD_LOAD_TEST_SSE_FRACTION ?? 0),
    pollIntervalOverrideSec: null,
    outputDir: join(ROOT, 'scripts/load-test-results/hud'),
    dryRun: false,
    startWithCachedBundle: true,
    convexProbeClients: Number(process.env.HUD_LOAD_TEST_CONVEX_PROBE_CLIENTS ?? 0),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) {
        throw new Error(`Missing value for ${a}`);
      }
      i += 1;
      return v;
    };

    switch (a) {
      case '--clients':
        args.clients = Number(next());
        break;
      case '--duration':
        args.durationSec = Number(next());
        break;
      case '--ramp':
        args.rampSec = Number(next());
        break;
      case '--server':
        args.serverName = next();
        break;
      case '--server-b':
        args.serverNameB = next();
        break;
      case '--battle':
      case '--scenario':
        args.scenario = next() as ScenarioName;
        break;
      case '--server-change':
        args.runServerChange = true;
        break;
      case '--server-change-pct':
        args.serverChangePct = Number(next());
        break;
      case '--server-change-at':
        args.serverChangeAtSec = Number(next());
        break;
      case '--api':
      case '--target':
        args.baseUrl = next();
        break;
      case '--profile':
        if (next() === 'progressive') {
          args.progressive = true;
        } else {
          args.profile = true;
        }
        break;
      case '--progressive':
        args.progressive = true;
        break;
      case '--confirm':
        args.confirm = true;
        break;
      case '--sse':
        args.enableSse = true;
        break;
      case '--sse-fraction':
        args.sseFraction = Number(next());
        break;
      case '--interval':
        args.pollIntervalOverrideSec = Number(next());
        break;
      case '--output':
        args.outputDir = next();
        break;
      case '--convex-probe':
        args.convexProbeClients = Number(next());
        break;
      case '--full-snapshot-all':
        args.startWithCachedBundle = false;
        args.convexProbeClients = args.clients;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (args.progressive) {
    args.profile = true;
  }

  return args;
}

function buildRunConfig(cli: CliArgs): RunConfig {
  const apiKey = process.env.HUD_API_KEY ?? '';
  const workerSecret = process.env.CONVEX_WORKER_SECRET ?? '';
  if (!apiKey) {
    throw new Error('HUD_API_KEY missing — set in .env.local');
  }

  return {
    baseUrl: cli.baseUrl,
    apiKey,
    workerSecret,
    redisUrl: process.env.REDIS_URL ?? '',
    instanceId: process.env.AC_INSTANCE_ID ?? 'default',
    serverName: cli.serverName,
    serverNameB: cli.serverNameB,
    clients: cli.clients,
    durationSec: cli.durationSec,
    rampSec: cli.rampSec,
    scenario: cli.runServerChange ? 'server-change' : cli.scenario,
    runServerChange: cli.runServerChange,
    serverChangePct: cli.serverChangePct,
    serverChangeAtSec: cli.serverChangeAtSec,
    enableSse: cli.enableSse || cli.sseFraction > 0,
    sseFraction: cli.sseFraction,
    pollIntervalOverrideSec: cli.pollIntervalOverrideSec,
    thresholds: DEFAULT_THRESHOLDS,
    outputDir: cli.outputDir,
    track: process.env.HUD_LOAD_TEST_TRACK ?? 'pk_akina',
    trackConfig: process.env.HUD_LOAD_TEST_TRACK_CONFIG ?? 'akina_downhill',
    carModel: process.env.HUD_LOAD_TEST_CAR ?? 'ks_mazda_rx7_spirit_r',
    battleTtlSec: Number(process.env.HUD_BATTLE_TTL_SEC ?? 120),
    dryRun: cli.dryRun,
    confirm: cli.confirm,
    startWithCachedBundle: cli.startWithCachedBundle,
    convexProbeClients: cli.convexProbeClients,
  };
}

async function runLevel(config: RunConfig): Promise<LevelResult> {
  assertSafeLoadTestTarget(config.baseUrl);
  requireLoadTestConfirmation(config.clients, config.confirm);

  console.log('');
  console.log(`=== HUD load level: ${config.clients} clients (${config.scenario}) ===`);
  console.log(`target=${config.baseUrl} duration=${config.durationSec}s ramp=${config.rampSec}s`);

  if (config.dryRun) {
    return {
      clients: config.clients,
      durationSec: config.durationSec,
      scenario: config.scenario,
      status: 'PASS',
      rps: 0,
      rpm: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      errorRate: 0,
      timeoutCount: 0,
      redisLatencyMs: null,
      cpuPercent: null,
      memoryMb: null,
      convexSessionCalls: 0,
      convexVersionCalls: 0,
      convexCallsPerClientPerMin: 0,
      syncDivergenceRate: 0,
      staleRate: 0,
      revisionRegressionRate: 0,
      stuckClients: 0,
      notes: ['dry-run'],
    };
  }

  const redis = await createRedisClient();
  const metrics = new MetricsCollector();
  const battleId = `loadtest-${Date.now()}`;

  const steamIds = await seedAllClients(redis, config.clients, {
    serverName: config.serverName,
    track: config.track,
    trackConfig: config.trackConfig,
    carModel: config.carModel,
    ttlSec: Math.max(config.battleTtlSec, 600),
    battleId,
  });

  const simulator = new BattleSimulator(redis, {
    instanceId: config.instanceId,
    serverName: config.serverName,
    track: config.track,
    trackConfig: config.trackConfig,
    carModel: config.carModel,
    battleTtlSec: config.battleTtlSec,
    verTtlSec: Number(process.env.HUD_VER_TTL_SEC ?? 3600),
    scenario: config.scenario === 'server-change' ? 'active' : config.scenario,
    steamIds,
  });
  simulator.start();

  const convexStart = await fetchConvexStats(config.baseUrl, config.workerSecret);

  const clients: HudSimClient[] = steamIds.map((steamId, index) => {
    const useSse =
      config.enableSse &&
      (config.sseFraction >= 1 || index / Math.max(1, config.clients) < config.sseFraction);
    return new HudSimClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      steamId,
      serverName: config.serverName,
      carModel: config.carModel,
      pollIntervalOverrideSec: config.pollIntervalOverrideSec,
      enableSse: useSse,
      requestTimeoutMs: Number(process.env.HUD_LOAD_TEST_TIMEOUT_MS ?? 15000),
      staleBattleSec: Number(process.env.HUD_LOAD_TEST_STALE_SEC ?? 3),
      startWithCachedBundle: config.startWithCachedBundle,
      probeFullSnapshot: index < config.convexProbeClients,
    });
  });

  const startedAt = Date.now();
  const endAt = startedAt + config.durationSec * 1000;
  const rampEnd = startedAt + config.rampSec * 1000;
  let startedCount = 0;

  const hostInterval = setInterval(() => {
    void sampleHostMetrics(redis).then((s) => metrics.recordHostSample(s));
  }, 5000);
  hostInterval.unref?.();

  // Server change scenario: move subset to server B mid-test.
  let serverChangeDone = false;
  const serverChangeTimer =
    config.runServerChange || config.scenario === 'server-change'
      ? setTimeout(() => {
          void (async () => {
            if (serverChangeDone) {
              return;
            }
            serverChangeDone = true;
            const moveCount = Math.max(1, Math.floor((config.serverChangePct / 100) * clients.length));
            const movers = clients.slice(0, moveCount);
            const moverIds = movers.map((c) => c.metrics.steamId);
            console.log(`[hud-load-test] server change: moving ${moveCount} clients → ${config.serverNameB}`);
            await moveClientsToServer(
              redis,
              moverIds,
              config.serverNameB,
              config.track,
              config.trackConfig,
              config.carModel,
              Math.max(config.battleTtlSec, 600),
            );
            for (const client of movers) {
              client.switchServer(config.serverNameB);
            }
          })();
        }, config.serverChangeAtSec * 1000)
      : null;
  serverChangeTimer?.unref?.();

  while (Date.now() < endAt) {
    while (startedCount < clients.length && Date.now() < rampEnd) {
      const batch = Math.max(1, Math.ceil(clients.length / (config.rampSec || 1)));
      const toStart = Math.min(batch, clients.length - startedCount);
      for (let i = 0; i < toStart; i += 1) {
        const client = clients[startedCount]!;
        client.start((sample) => metrics.recordRequest(sample));
        startedCount += 1;
      }
      await sleep(1000);
    }
    while (startedCount < clients.length) {
      const client = clients[startedCount]!;
      client.start((sample) => metrics.recordRequest(sample));
      startedCount += 1;
    }
    await sleep(500);
  }

  if (serverChangeTimer) {
    clearTimeout(serverChangeTimer);
  }
  clearInterval(hostInterval);

  await simulator.stop();
  await Promise.all(clients.map((c) => c.stop()));
  await redis.quit();

  const convexEnd = await fetchConvexStats(config.baseUrl, config.workerSecret);
  const sessionDelta =
    (convexEnd?.fetchHudSession ?? 0) - (convexStart?.fetchHudSession ?? 0);
  const versionDelta =
    (convexEnd?.fetchHudVersion ?? 0) - (convexStart?.fetchHudVersion ?? 0);
  const minutes = config.durationSec / 60;
  const convexCallsPerClientPerMin =
    config.clients > 0 && minutes > 0
      ? (sessionDelta + versionDelta) / config.clients / minutes
      : 0;

  const sync = evaluateSync(clients, simulator.getPairs());

  const lat = metrics.latencyStats();
  const health = metrics.evaluateHealth({
    thresholds: config.thresholds,
    syncDivergenceRate: sync.divergenceRate,
    staleRate: sync.staleRate,
    revisionRegressionRate: sync.revisionRegressionRate,
    stuckClients: sync.stuckClients,
    convexCallsPerClientPerMin,
  });

  return {
    clients: config.clients,
    durationSec: config.durationSec,
    scenario: config.scenario,
    status: health.status,
    rps: metrics.rps(),
    rpm: metrics.rpm(),
    p50Ms: lat.p50,
    p95Ms: lat.p95,
    p99Ms: lat.p99,
    maxMs: lat.max,
    errorRate: metrics.battleErrorRate(),
    timeoutCount: metrics.timeoutCount,
    redisLatencyMs: metrics.avgHostMetric('redisLatencyMs'),
    cpuPercent: metrics.maxHostMetric('cpuPercent'),
    memoryMb: metrics.maxHostMetric('memoryMb'),
    convexSessionCalls: sessionDelta,
    convexVersionCalls: versionDelta,
    convexCallsPerClientPerMin,
    syncDivergenceRate: sync.divergenceRate,
    staleRate: sync.staleRate,
    revisionRegressionRate: sync.revisionRegressionRate,
    stuckClients: sync.stuckClients,
    notes: [
      ...health.notes,
      `convex session=${sessionDelta} version=${versionDelta}`,
      `sync pairs diverged=${sync.divergentPairs}/${sync.pairChecks}`,
    ],
  };
}

async function runProgressive(baseCli: CliArgs): Promise<ProgressiveReport> {
  const startedAt = new Date().toISOString();
  const levels: LevelResult[] = [];
  const target = baseCli.baseUrl;

  for (const count of PROGRESSIVE_LEVELS) {
    const config = buildRunConfig({ ...baseCli, clients: count, progressive: false });
    config.clients = count;
    requireLoadTestConfirmation(count, baseCli.confirm);

    const level = await runLevel(config);
    levels.push(level);

    if (level.status === 'FAIL') {
      break;
    }
    if (count >= 1000 && level.status === 'WARNING') {
      break;
    }
  }

  const capacity = deriveCapacityPoints(levels);
  const report: ProgressiveReport = {
    target,
    startedAt,
    finishedAt: new Date().toISOString(),
    levels,
    ...capacity,
  };

  printReport(report);
  mkdirSync(baseCli.outputDir, { recursive: true });
  writeReportFiles(report, baseCli.outputDir);
  return report;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  assertSafeLoadTestTarget(cli.baseUrl);

  if (cli.progressive) {
    await runProgressive(cli);
    return;
  }

  requireLoadTestConfirmation(cli.clients, cli.confirm);
  const startedAt = new Date().toISOString();
  const config = buildRunConfig(cli);
  const level = await runLevel(config);

  const report: ProgressiveReport = {
    target: cli.baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    levels: [level],
    ...deriveCapacityPoints([level]),
  };

  printReport(report);
  mkdirSync(cli.outputDir, { recursive: true });
  writeReportFiles(report, cli.outputDir);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
