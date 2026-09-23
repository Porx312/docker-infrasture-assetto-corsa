import { isFleetModeEnabled } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';

/** When true, content/HUD admin and previews are served from hub disk (not proxied to an edge). */
export function isHubOwnsContent(): boolean {
  const raw = (process.env.HUB_OWNS_CONTENT ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  return isFleetModeEnabled();
}
