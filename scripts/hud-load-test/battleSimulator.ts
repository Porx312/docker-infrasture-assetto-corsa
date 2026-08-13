import type { RedisClientType } from 'redis';

import { battleServerKey, writeBattleSnapshot } from './redisSeed.js';
import type { ScenarioName } from './types.js';

export type BattlePair = {
  battleId: string;
  clientA: string;
  clientB: string;
  index: number;
};

export type BattleSimulatorOptions = {
  instanceId: string;
  serverName: string;
  track: string;
  trackConfig: string;
  carModel: string;
  battleTtlSec: number;
  verTtlSec: number;
  scenario: ScenarioName;
  steamIds: string[];
};

type PhaseSpec = {
  state: string;
  durationMs: number;
  p1Score?: number;
  p2Score?: number;
  armingCountdown?: number;
};

const LIFECYCLE_PHASES: PhaseSpec[] = [
  { state: 'pairing', durationMs: 4000 },
  { state: 'arming', durationMs: 1000, armingCountdown: 5 },
  { state: 'arming', durationMs: 1000, armingCountdown: 4 },
  { state: 'arming', durationMs: 1000, armingCountdown: 3 },
  { state: 'arming', durationMs: 1000, armingCountdown: 2 },
  { state: 'arming', durationMs: 1000, armingCountdown: 1 },
  { state: 'armed', durationMs: 1500 },
  { state: 'launching', durationMs: 1500 },
  { state: 'active', durationMs: 8000, p1Score: 0, p2Score: 0 },
  { state: 'active', durationMs: 6000, p1Score: 1, p2Score: 0 },
  { state: 'active', durationMs: 6000, p1Score: 1, p2Score: 1 },
  { state: 'active', durationMs: 6000, p1Score: 2, p2Score: 1 },
  { state: 'finished', durationMs: 5000, p1Score: 3, p2Score: 2 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BattleSimulator {
  private readonly serverKey: string;
  private readonly pairs: BattlePair[] = [];
  private versionCounter = 0;
  private pointsLog: Array<{ scorer: string; reason: string; ts: number; label: string }> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lifecycleTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleIndex = 0;
  private activeScores = { p1: 0, p2: 0 };
  private stopped = false;
  private inFlight = 0;

  constructor(
    private readonly redis: RedisClientType,
    private readonly opts: BattleSimulatorOptions,
  ) {
    this.serverKey = battleServerKey(opts.instanceId, opts.serverName);
    for (let i = 0; i + 1 < opts.steamIds.length; i += 2) {
      this.pairs.push({
        battleId: `loadtest-battle-${Math.floor(i / 2)}`,
        clientA: opts.steamIds[i]!,
        clientB: opts.steamIds[i + 1]!,
        index: Math.floor(i / 2),
      });
    }
    if (opts.steamIds.length % 2 === 1) {
      const last = opts.steamIds[opts.steamIds.length - 1]!;
      this.pairs.push({
        battleId: `loadtest-battle-solo-${last}`,
        clientA: last,
        clientB: last,
        index: this.pairs.length,
      });
    }
  }

  start(): void {
    if (this.opts.scenario === 'idle') {
      return;
    }

    if (this.opts.scenario === 'lifecycle') {
      void this.runLifecycleLoop();
      return;
    }

    const intervalMs =
      this.opts.scenario === 'score' ? 800 : this.opts.scenario === 'active' ? 500 : 2000;

    void this.publishActiveBattles();
    this.timer = setInterval(() => {
      void this.publishActiveBattles();
    }, intervalMs);
    this.timer.unref?.();
  }

  getPairs(): BattlePair[] {
    return this.pairs;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.lifecycleTimer) {
      clearTimeout(this.lifecycleTimer);
      this.lifecycleTimer = null;
    }
    while (this.inFlight > 0) {
      await sleep(25);
    }
  }

  private nextVersion(): string {
    this.versionCounter += 1;
    return String(Date.now() * 1000 + this.versionCounter);
  }

  private profile(steamId: string, index: number) {
    return {
      steamId,
      name: `LoadTest${index + 1}`,
      tier: 5,
      elo: 1500,
      car_id: this.opts.carModel,
      car_name: this.opts.carModel,
    };
  }

  private buildSnapshot(
    pair: BattlePair,
    state: string,
    p1Score: number,
    p2Score: number,
    armingCountdown?: number,
  ): Record<string, unknown> {
    const version = this.nextVersion();
    const snapshot: Record<string, unknown> = {
      ok: true,
      version,
      revision: this.versionCounter,
      battleId: pair.battleId,
      state,
      serverName: this.opts.serverName,
      track: this.opts.track,
      trackConfig: this.opts.trackConfig,
      player1: { ...this.profile(pair.clientA, pair.index * 2), score: p1Score, role: 'chaser' },
      player2: {
        ...this.profile(pair.clientB, pair.index * 2 + 1),
        score: p2Score,
        role: 'leader',
      },
      pointsLog: [...this.pointsLog],
      disappearGapM: 250,
      status: state === 'finished' ? 'finished' : 'active',
      gap3dM: 12.5,
    };
    if (armingCountdown !== undefined) {
      snapshot.armingCountdownSec = armingCountdown;
    }
    if (state === 'finished') {
      snapshot.winnerSteamId = pair.clientA;
      snapshot.endLabel = 'win';
    }
    return snapshot;
  }

  private async publishForPair(
    pair: BattlePair,
    state: string,
    p1Score: number,
    p2Score: number,
    armingCountdown?: number,
  ): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.inFlight += 1;
    try {
      const snapshot = this.buildSnapshot(pair, state, p1Score, p2Score, armingCountdown);
      for (const steamId of new Set([pair.clientA, pair.clientB])) {
        if (this.stopped) {
          return;
        }
        await writeBattleSnapshot(
          this.redis,
          this.serverKey,
          steamId,
          snapshot,
          this.opts.battleTtlSec,
          this.opts.verTtlSec,
        );
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  private async publishActiveBattles(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.opts.scenario === 'score') {
      this.activeScores.p1 += 1;
      if (this.activeScores.p1 > 3) {
        this.activeScores = { p1: 0, p2: 0 };
        this.pointsLog = [];
      }
      if (this.activeScores.p1 > 0) {
        this.pointsLog.push({
          scorer: 'p1',
          reason: 'overtake',
          ts: Date.now(),
          label: 'Overtake',
        });
      }
    }

    for (const pair of this.pairs) {
      await this.publishForPair(
        pair,
        'active',
        this.activeScores.p1,
        this.activeScores.p2,
      );
    }
  }

  private async runLifecycleLoop(): Promise<void> {
    const tick = async () => {
      if (this.stopped) {
        return;
      }
      const phase = LIFECYCLE_PHASES[this.lifecycleIndex % LIFECYCLE_PHASES.length]!;
      for (const pair of this.pairs) {
        await this.publishForPair(
          pair,
          phase.state,
          phase.p1Score ?? 0,
          phase.p2Score ?? 0,
          phase.armingCountdown,
        );
      }
      this.lifecycleIndex += 1;
      this.lifecycleTimer = setTimeout(() => {
        void tick();
      }, phase.durationMs);
      this.lifecycleTimer.unref?.();
    };
    await tick();
  }
}
