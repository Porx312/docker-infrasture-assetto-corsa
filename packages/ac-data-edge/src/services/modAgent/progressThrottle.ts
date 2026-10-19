/**
 * Gate hub progress POSTs so download chunks do not enqueue hundreds of identical reports.
 * Emit when the integer % changes, or every `minIntervalMs` (whichever comes first).
 * Always emit forced / 100%.
 */
export type ProgressThrottleState = {
  lastPct: number;
  lastAt: number;
};

export function createProgressThrottleState(): ProgressThrottleState {
  return { lastPct: -1, lastAt: 0 };
}

export function shouldEmitProgress(
  state: ProgressThrottleState,
  pct: number,
  nowMs: number,
  minIntervalMs = 500,
  force = false,
): boolean {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (force || clamped >= 100) {
    if (!force && state.lastPct === 100 && clamped === 100) {
      return false;
    }
    state.lastPct = clamped;
    state.lastAt = nowMs;
    return true;
  }
  const pctChanged = clamped !== state.lastPct;
  const intervalElapsed = nowMs - state.lastAt >= minIntervalMs;
  if (!pctChanged && !intervalElapsed) {
    return false;
  }
  state.lastPct = clamped;
  state.lastAt = nowMs;
  return true;
}
