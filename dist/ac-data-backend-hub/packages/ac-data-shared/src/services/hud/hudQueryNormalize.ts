import { stripCmNameSuffix } from '../../controller/cmWrapper.js';

/**
 * Strip Content Manager port suffix (ℹ18081) so Convex resolveServerByName matches
 * telemetry display_server_name / Redis serverName.
 */
export function normalizeHudServerName(serverName: string): string {
  return stripCmNameSuffix(serverName.trim());
}
