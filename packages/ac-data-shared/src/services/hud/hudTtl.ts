/**
 * HUD Redis TTL defaults (hub + edge).
 * Presence default (450) must exceed telemetry server_status heartbeat (300).
 */

export const HUD_PRESENCE_TTL_DEFAULT_SEC = 450;
export const HUD_PRESENCE_JOIN_TTL_DEFAULT_SEC = 600;
export const HUD_CONN_PRESENCE_TTL_DEFAULT_SEC = 45;
export const HUD_PLAYER_TTL_DEFAULT_SEC = 300;
export const HUD_SESSION_TTL_DEFAULT_SEC = 300;
export const HUD_BATTLE_PROFILE_TTL_DEFAULT_SEC = 3600;
export const HUD_PLAYER_NOT_CONNECTED_TTL_DEFAULT_SEC = 4;
export const HUD_TRANSIENT_ERROR_TTL_DEFAULT_SEC = 10;

function envNumber(name: string, fallback: number): number {
  return Number(process.env[name] || fallback);
}

export function hudPlayerTtlSec(): number {
  return envNumber('HUD_PLAYER_TTL_SEC', HUD_PLAYER_TTL_DEFAULT_SEC);
}

export function hudSessionTtlSec(): number {
  return envNumber('HUD_SESSION_TTL_SEC', HUD_SESSION_TTL_DEFAULT_SEC);
}

export function hudBattleProfileTtlSec(): number {
  return envNumber('HUD_BATTLE_PROFILE_TTL_SEC', HUD_BATTLE_PROFILE_TTL_DEFAULT_SEC);
}

export function hudPlayerNotConnectedTtlSec(): number {
  return envNumber('HUD_PLAYER_NOT_CONNECTED_TTL_SEC', HUD_PLAYER_NOT_CONNECTED_TTL_DEFAULT_SEC);
}

export function hudTransientErrorTtlSec(): number {
  return envNumber('HUD_TRANSIENT_ERROR_TTL_SEC', HUD_TRANSIENT_ERROR_TTL_DEFAULT_SEC);
}

export function hudPresenceTtlSec(): number {
  return envNumber('HUD_PRESENCE_TTL_SEC', HUD_PRESENCE_TTL_DEFAULT_SEC);
}

export function hudPresenceJoinTtlSec(): number {
  return envNumber('HUD_PRESENCE_JOIN_TTL_SEC', HUD_PRESENCE_JOIN_TTL_DEFAULT_SEC);
}

export function hudConnPresenceTtlSec(): number {
  // Legacy env alias HUD_SSE_PRESENCE_TTL_SEC kept for ops during conn migration.
  return envNumber(
    'HUD_CONN_PRESENCE_TTL_SEC',
    envNumber('HUD_SSE_PRESENCE_TTL_SEC', HUD_CONN_PRESENCE_TTL_DEFAULT_SEC),
  );
}

/** Eager constants matching historical `export const HUD_*_TTL_SEC = Number(...)` load-time evaluation. */
export const HUD_PLAYER_TTL_SEC = hudPlayerTtlSec();
export const HUD_SESSION_TTL_SEC = hudSessionTtlSec();
export const HUD_BATTLE_PROFILE_TTL_SEC = hudBattleProfileTtlSec();
export const HUD_PLAYER_NOT_CONNECTED_TTL_SEC = hudPlayerNotConnectedTtlSec();
export const HUD_TRANSIENT_ERROR_TTL_SEC = hudTransientErrorTtlSec();
export const HUD_PRESENCE_TTL_SEC = hudPresenceTtlSec();
export const HUD_PRESENCE_JOIN_TTL_SEC = hudPresenceJoinTtlSec();
export const HUD_CONN_PRESENCE_TTL_SEC = hudConnPresenceTtlSec();
