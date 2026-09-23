/** Worker webhook reasons that may trigger live getHudSession (not join context alone). */
export const HUD_SESSION_FETCH_REASONS = new Set(['cosmetics', 'worker_cosmetics']);

/**
 * Join + push-only: proactive paths must not call getHudSession.
 * Only explicit webhook reasons (cosmetics) allow a live session fetch.
 */
export function shouldFetchHudSession(reason?: string): boolean {
  if (reason === undefined || reason.trim() === '') {
    return false;
  }
  return HUD_SESSION_FETCH_REASONS.has(reason.trim());
}
