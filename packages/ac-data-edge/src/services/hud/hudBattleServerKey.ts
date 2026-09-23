import { normalizeHudKeyPart } from './hudCacheKeys.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';

/** Fleet-scoped battle Redis key prefix (matches telemetry battle_server_key). */
export function battleInstanceId(): string {
  const raw = (process.env.AC_INSTANCE_ID || 'default').trim();
  return raw || 'default';
}

/**
 * Redis battle scope/cache server part: `{instanceId}_{normalizedDisplayName}`.
 * Prevents collisions when multiple VPS share Redis Cloud with the same lobby NAME.
 */
export function buildBattleServerKey(displayServerName: string): string {
  const instance = normalizeHudKeyPart(battleInstanceId());
  const display = normalizeHudKeyPart(normalizeHudServerName(displayServerName));
  return `${instance}_${display}`;
}
