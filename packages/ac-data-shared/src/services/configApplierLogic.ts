import crypto from 'node:crypto';
import { normalizeTrackConfigForIni } from '../controller/trackConfig.js';
import { normalizeTimeOfDay } from './timeOfDayPresets.js';

export type ConfigServerRow = {
  serverId?: string;
  serverName: string;
  displayName?: string;
  type?: string;
  isActive?: boolean;
  instanceId?: string;
  password?: string;
  maxClients?: number;
  rotationEnabled?: boolean;
  track?: string;
  trackName?: string;
  trackConfig?: string;
  entries?: Array<{ model: string; skin?: string; count?: number }>;
  updatedAt?: number;
  /** day | night | dynamic → SUN_ANGLE + TIME_OF_DAY_MULT */
  timeOfDay?: string;
  tyreBlanketsAllowed?: boolean;
};

/** Stable hash of config fields that trigger INI apply / restart. */
export function buildConfigSignature(row: ConfigServerRow): string {
  const normalized = {
    displayName: row.displayName ?? '',
    password: row.password ?? '',
    track: row.track ?? '',
    trackConfig: normalizeTrackConfigForIni(row.trackConfig) ?? '',
    maxClients: row.maxClients ?? 0,
    isActive: !!row.isActive,
    entries: (row.entries ?? []).map((e) => ({
      model: e.model,
      skin: e.skin ?? '',
      count: e.count ?? 1,
    })),
    timeOfDay: normalizeTimeOfDay(row.timeOfDay) ?? '',
    tyreBlanketsAllowed:
      row.tyreBlanketsAllowed === undefined ? null : !!row.tyreBlanketsAllowed,
  };
  return crypto.createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
}
