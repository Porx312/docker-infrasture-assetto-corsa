import { HUD_POLL_INTERVALS } from './config.js';
import type { HudClientMetrics, HudClientSnapshotState } from './types.js';

const PREP_PHASES = new Set(['pairing', 'arming', 'armed', 'launching']);

export type HudClientOptions = {
  baseUrl: string;
  apiKey: string;
  steamId: string;
  serverName: string;
  carModel: string;
  pollIntervalOverrideSec: number | null;
  enableWs: boolean;
  /** @deprecated use enableWs */
  enableSse?: boolean;
  requestTimeoutMs: number;
  staleBattleSec: number;
  /** When true, skip initial sections=full (steady-state battle polling after Redis session seed). */
  startWithCachedBundle: boolean;
  /** When true, perform one sections=full at connect to measure Convex path. */
  probeFullSnapshot: boolean;
};

type BattlePayload = {
  ok: boolean;
  reason?: string;
  battleId?: string | null;
  state?: string;
  version?: string;
  revision?: number;
  player1?: { score?: number };
  player2?: { score?: number };
  pointsLog?: unknown[];
};

type SnapshotResponse = {
  ok?: boolean;
  sections?: string;
  battle?: BattlePayload;
  reason?: string;
};

function parseRevision(version: string | null | undefined): number | null {
  if (!version) {
    return null;
  }
  const n = Number(version);
  return Number.isFinite(n) ? n : null;
}

export class HudSimClient {
  readonly metrics: HudClientMetrics;
  private cachedBundle = false;
  private battleUi: { state: string } | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private lastPollAt = 0;
  private lastBattleAt = 0;
  private ws: WebSocket | null = null;
  private lastRevision: number | null = null;

  constructor(private readonly opts: HudClientOptions) {
    this.metrics = {
      steamId: opts.steamId,
      serverName: opts.serverName,
      successfulSnapshots: 0,
      failedSnapshots: 0,
      timeouts: 0,
      connectionFailures: 0,
      reconnects: 0,
      missedSnapshots: 0,
      staleSnapshots: 0,
      outOfOrderSnapshots: 0,
      revisionRegressions: 0,
      fullSnapshots: 0,
      battleSnapshots: 0,
      waitingMs: 0,
      lastSnapshot: null,
      latenciesMs: [],
    };
  }

  start(onSample: (sample: { ms: number; ok: boolean; status: number; sections: 'full' | 'battle' }) => void): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const useWs = this.opts.enableWs || this.opts.enableSse === true;
    if (useWs) {
      void this.connectWs();
    }
    this.loopPromise = this.runLoop(onSample);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.ws?.close();
    await this.loopPromise;
  }

  isStuck(now = Date.now()): boolean {
    if (this.lastPollAt === 0) {
      return false;
    }
    return now - this.lastPollAt > 30_000;
  }

  private pollIntervalSec(nowSec: number): number {
    if (this.opts.pollIntervalOverrideSec !== null) {
      return this.opts.pollIntervalOverrideSec;
    }

    const ui = this.battleUi;
    if (ui) {
      const phase = ui.state.toLowerCase();
      if (PREP_PHASES.has(phase)) {
        return HUD_POLL_INTERVALS.prepSec;
      }
      if (phase === 'active') {
        return HUD_POLL_INTERVALS.battleActiveSec;
      }
      return HUD_POLL_INTERVALS.battleWaitSec;
    }

    if (this.cachedBundle) {
      return HUD_POLL_INTERVALS.battleWaitSec;
    }

    return HUD_POLL_INTERVALS.defaultSec;
  }

  private snapshotUrl(sections: 'full' | 'battle'): string {
    const params = new URLSearchParams({
      steamId: this.opts.steamId,
      carFilter: 'global',
      sections,
      carModel: this.opts.carModel,
      api_key: this.opts.apiKey,
    });
    return `${this.opts.baseUrl.replace(/\/$/, '')}/hud/snapshot?${params.toString()}`;
  }

  private async fetchSnapshot(sections: 'full' | 'battle'): Promise<{
    ok: boolean;
    status: number;
    body: SnapshotResponse | null;
    ms: number;
  }> {
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.requestTimeoutMs);
    try {
      const res = await fetch(this.snapshotUrl(sections), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const ms = performance.now() - start;
      let body: SnapshotResponse | null = null;
      try {
        body = (await res.json()) as SnapshotResponse;
      } catch {
        body = null;
      }
      return { ok: res.ok && body?.ok !== false, status: res.status, body, ms };
    } catch (err) {
      const ms = performance.now() - start;
      if (err instanceof Error && err.name === 'AbortError') {
        this.metrics.timeouts += 1;
      } else {
        this.metrics.connectionFailures += 1;
      }
      return { ok: false, status: 0, body: null, ms };
    } finally {
      clearTimeout(timeout);
    }
  }

  private processBattle(battle: BattlePayload | undefined, receivedAt: number): void {
    if (!battle?.ok) {
      this.battleUi = null;
      return;
    }

    const state = (battle.state ?? 'none').toLowerCase();
    this.battleUi = { state };
    this.lastBattleAt = receivedAt;

    const revision = battle.revision ?? parseRevision(battle.version);
    const snapshot: HudClientSnapshotState = {
      battleId: battle.battleId ?? null,
      state,
      version: battle.version ?? null,
      revision,
      p1Score: battle.player1?.score ?? null,
      p2Score: battle.player2?.score ?? null,
      pointsLogLen: Array.isArray(battle.pointsLog) ? battle.pointsLog.length : 0,
      receivedAt,
    };

    if (revision !== null && this.lastRevision !== null && revision < this.lastRevision) {
      this.metrics.revisionRegressions += 1;
      this.metrics.outOfOrderSnapshots += 1;
    }
    if (revision !== null) {
      this.lastRevision = revision;
    }

    const prev = this.metrics.lastSnapshot;
    if (prev && prev.battleId === snapshot.battleId && prev.state === 'active') {
      const ageSec = (receivedAt - prev.receivedAt) / 1000;
      if (ageSec > this.opts.staleBattleSec && snapshot.version === prev.version) {
        this.metrics.staleSnapshots += 1;
      }
    }

    this.metrics.lastSnapshot = snapshot;
  }

  private async runLoop(
    onSample: (sample: { ms: number; ok: boolean; status: number; sections: 'full' | 'battle' }) => void,
  ): Promise<void> {
    if (this.opts.probeFullSnapshot) {
      const full = await this.fetchSnapshot('full');
      onSample({ ms: full.ms, ok: full.ok, status: full.status, sections: 'full' });
      this.lastPollAt = Date.now();
      if (full.ok) {
        this.cachedBundle = true;
        this.metrics.successfulSnapshots += 1;
        this.metrics.fullSnapshots += 1;
        this.metrics.latenciesMs.push(full.ms);
        this.processBattle(full.body?.battle, Date.now());
      } else {
        this.metrics.failedSnapshots += 1;
        this.metrics.latenciesMs.push(full.ms);
      }
    } else if (this.opts.startWithCachedBundle) {
      this.cachedBundle = true;
    }

    while (this.running) {
      const intervalSec = this.pollIntervalSec(Date.now() / 1000);
      await sleep(intervalSec * 1000);

      const battle = await this.fetchSnapshot('battle');
      onSample({ ms: battle.ms, ok: battle.ok, status: battle.status, sections: 'battle' });
      this.lastPollAt = Date.now();

      if (battle.ok) {
        this.metrics.successfulSnapshots += 1;
        this.metrics.battleSnapshots += 1;
        this.metrics.latenciesMs.push(battle.ms);
        this.processBattle(battle.body?.battle, Date.now());
      } else {
        this.metrics.failedSnapshots += 1;
        this.metrics.latenciesMs.push(battle.ms);
        if (battle.status === 404 && battle.body?.reason) {
          // Presence/session issues — retry full snapshot like real client on mismatch.
          this.cachedBundle = false;
          this.metrics.reconnects += 1;
        }
      }
    }
  }

  private connectWs(): void {
    const wsBase = this.opts.baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const params = new URLSearchParams({
      steamId: this.opts.steamId,
      api_key: this.opts.apiKey,
    });
    const url = `${wsBase.replace(/\/$/, '')}/hud/ws?${params.toString()}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.onmessage = () => {
        // Drain WSS frames; battle updates also arrive via snapshot poll backup path.
      };
      this.ws.onclose = () => {
        if (this.running) {
          this.metrics.reconnects += 1;
        }
      };
      this.ws.onerror = () => {
        if (this.running) {
          this.metrics.connectionFailures += 1;
        }
      };
    } catch {
      if (this.running) {
        this.metrics.reconnects += 1;
      }
    }
  }

  switchServer(serverName: string): void {
    this.opts.serverName = serverName;
    this.cachedBundle = false;
    this.battleUi = null;
    this.metrics.reconnects += 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
