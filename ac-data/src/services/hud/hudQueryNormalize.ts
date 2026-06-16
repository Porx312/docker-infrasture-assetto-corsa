import { stripCmNameSuffix } from '../../controller/cmWrapper.js';

export type NormalizedHudQuery = {
  serverName: string;
  track: string;
  trackConfig?: string;
};

/**
 * Strip Content Manager port suffix (ℹ18081) so Convex resolveServerByName matches
 * telemetry display_server_name / Redis serverName.
 */
export function normalizeHudServerName(serverName: string): string {
  return stripCmNameSuffix(serverName.trim());
}

/**
 * AC INFO often sends `pk_akina-akina_downhill`; Convex expects track + trackConfig.
 * Split on the first `-` when trackConfig is omitted.
 */
export function normalizeHudTrack(
  track: string,
  trackConfig?: string,
): { track: string; trackConfig?: string } {
  const trimmedTrack = track.trim();
  const trimmedConfig = trackConfig?.trim();

  if (trimmedConfig) {
    return { track: trimmedTrack, trackConfig: trimmedConfig };
  }

  const dash = trimmedTrack.indexOf('-');
  if (dash <= 0) {
    return { track: trimmedTrack };
  }

  return {
    track: trimmedTrack.slice(0, dash),
    trackConfig: trimmedTrack.slice(dash + 1),
  };
}

export function normalizeHudQuery(
  serverName: string,
  track: string,
  trackConfig?: string,
): NormalizedHudQuery {
  const normalizedTrack = normalizeHudTrack(track, trackConfig);
  return {
    serverName: normalizeHudServerName(serverName),
    track: normalizedTrack.track,
    trackConfig: normalizedTrack.trackConfig,
  };
}
