/**
 * Per-server startup lifecycle for ProjectD Host (agent presence).
 * Phases are Host-facing; coarse status is derived for purge/compat.
 */

export type ServerLifecyclePhase =
  | 'PREPARING'
  | 'CONFIGURING'
  | 'STARTING'
  | 'CHECKING'
  | 'ONLINE'
  | 'FAILED';

export type ServerLifecycleState = {
  phase: ServerLifecyclePhase;
  phaseDetail?: string;
  phaseUpdatedAt: number;
};

export type CoarseAgentStatus = 'idle' | 'starting' | 'live' | 'error';

const PHASE_DETAIL_MAX = 240;

const states = new Map<string, ServerLifecycleState>();

let dirty = false;
let flushInFlight = false;
let publishHeartbeat: (() => Promise<void>) | null = null;

function normalizeServerName(serverName: string): string {
  return String(serverName || '').trim();
}

function normalizeDetail(detail?: string): string | undefined {
  const t = String(detail || '').trim();
  if (!t) return undefined;
  return t.length > PHASE_DETAIL_MAX ? t.slice(0, PHASE_DETAIL_MAX) : t;
}

/** Map Host phase → coarse presence status (purge / legacy consumers). */
export function coarseStatusForPhase(phase: ServerLifecyclePhase): CoarseAgentStatus {
  if (phase === 'ONLINE') return 'live';
  if (phase === 'FAILED') return 'error';
  return 'starting';
}

export function getServerLifecycle(serverName: string): ServerLifecycleState | null {
  const key = normalizeServerName(serverName);
  if (!key) return null;
  return states.get(key) ?? null;
}

/** Snapshot for presence publisher (copy). */
export function listServerLifecycles(): Map<string, ServerLifecycleState> {
  return new Map(states);
}

/**
 * Inject heartbeat publisher (avoids circular import with controlApiAgentPresence).
 * Called once from presence module on load / start.
 */
export function setLifecycleHeartbeatPublisher(fn: (() => Promise<void>) | null): void {
  publishHeartbeat = fn;
}

function scheduleForcedHeartbeat(): void {
  dirty = true;
  if (flushInFlight) return;
  flushInFlight = true;
  void (async () => {
    try {
      while (dirty) {
        dirty = false;
        if (publishHeartbeat) {
          await publishHeartbeat();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[server-lifecycle] forced heartbeat failed: ${message}`);
    } finally {
      flushInFlight = false;
      if (dirty) {
        scheduleForcedHeartbeat();
      }
    }
  })();
}

/**
 * Set lifecycle phase. No-op (no heartbeat) when phase+detail unchanged.
 * FAILED is kept until clearServerLifecycle / a newer phase overwrites it.
 */
export function setServerLifecycle(
  serverName: string,
  phase: ServerLifecyclePhase,
  detail?: string,
): void {
  const key = normalizeServerName(serverName);
  if (!key) return;
  const phaseDetail = normalizeDetail(detail);
  const prev = states.get(key);
  if (prev && prev.phase === phase && (prev.phaseDetail || undefined) === phaseDetail) {
    return;
  }
  states.set(key, {
    phase,
    ...(phaseDetail ? { phaseDetail } : {}),
    phaseUpdatedAt: Date.now(),
  });
  scheduleForcedHeartbeat();
}

/** Clear phase fields (stopped / isActive false). Triggers heartbeat. */
export function clearServerLifecycle(serverName: string): void {
  const key = normalizeServerName(serverName);
  if (!key) return;
  if (!states.has(key)) return;
  states.delete(key);
  scheduleForcedHeartbeat();
}

/** Test helper. */
export function _resetServerLifecycleForTests(): void {
  states.clear();
  dirty = false;
  flushInFlight = false;
  publishHeartbeat = null;
}

/** Test helper: wait until coalesced heartbeat flush finishes. */
export async function _flushLifecycleHeartbeatForTests(): Promise<void> {
  for (let i = 0; i < 50 && (dirty || flushInFlight); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
}
