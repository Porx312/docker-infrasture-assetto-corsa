/** Shared HUD error reasons that should use short TTL cache (not permanent). */
export const TRANSIENT_HUD_ERROR_REASONS = new Set<string>([
  'server_not_found',
  'track_not_found',
  'car_not_found',
]);

export function isTransientHudErrorReason(reason: string): boolean {
  return reason === 'player_not_connected' || TRANSIENT_HUD_ERROR_REASONS.has(reason);
}
