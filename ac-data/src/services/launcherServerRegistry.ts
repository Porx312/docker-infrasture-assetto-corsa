import '../config/loadEnv.js';
import { activeServers } from '../controller/controller.js';
import type { LauncherContentEntry } from './contentSyncService.js';
import { buildRequiredContentForServer } from './contentSyncService.js';
import { readServerInstanceConfig } from './serverInstanceConfig.js';
import { resolveServerFolder, shouldStartFromConfig } from './serverPool.js';

const SERVER_FOLDER_PATTERN = /^server(-\d+)?$/;

export type LauncherServerSnapshotRow = {
  serverName: string;
  displayName?: string;
  type?: string;
  isActive?: boolean;
  instanceId?: string;
};

export type LauncherServerRequiredContent = {
  cars: LauncherContentEntry[];
  track: LauncherContentEntry | null;
};

export type LauncherServerEntry = {
  serverName: string;
  displayName: string;
  type: string;
  track: string;
  trackConfig: string;
  cars: string[];
  httpPort: number;
  udpPort: number | null;
  maxClients: number;
  playerCount: number;
  hasPassword: boolean;
  joinUrl: string;
  isRunning: true;
  requiredContent: LauncherServerRequiredContent;
};

const snapshotByFolder = new Map<string, LauncherServerSnapshotRow>();
const playerCountByFolder = new Map<string, number>();

let missingJoinHostWarned = false;

export function resetLauncherServerRegistryForTests(): void {
  snapshotByFolder.clear();
  playerCountByFolder.clear();
  missingJoinHostWarned = false;
}

export function updateLauncherServerSnapshot(rows: LauncherServerSnapshotRow[]): void {
  const instanceId = process.env.AC_INSTANCE_ID || 'default';
  snapshotByFolder.clear();
  for (const row of rows) {
    if (!row.serverName) continue;
    if (row.instanceId && row.instanceId !== instanceId) continue;
    snapshotByFolder.set(row.serverName, row);
  }
}

export function noteLauncherServerPlayerCount(statusServerName: string, playerCount: number): void {
  let folder = resolveServerFolder(statusServerName);
  if (!folder && SERVER_FOLDER_PATTERN.test(statusServerName)) {
    folder = statusServerName;
  }
  if (!folder) return;
  playerCountByFolder.set(folder, Math.max(0, playerCount));
}

export function parseCarsField(cars: string): string[] {
  return cars
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildAcstuffJoinUrl(httpPort: number): string | null {
  const host = process.env.LAUNCHER_AC_HOST?.trim();
  if (!host || !Number.isFinite(httpPort)) {
    return null;
  }
  return `https://acstuff.club/s/q:race/online/join?ip=${encodeURIComponent(host)}&httpPort=${httpPort}`;
}

export function buildActiveLauncherServers(): Omit<LauncherServerEntry, 'requiredContent'>[] {
  const host = process.env.LAUNCHER_AC_HOST?.trim();
  if (!host && !missingJoinHostWarned) {
    console.warn('[launcher-server-registry] LAUNCHER_AC_HOST missing — no joinable servers exposed');
    missingJoinHostWarned = true;
  }

  const results: Omit<LauncherServerEntry, 'requiredContent'>[] = [];

  for (const [serverName, row] of snapshotByFolder) {
    if (!shouldStartFromConfig(row.isActive)) continue;
    if (!activeServers[serverName]?.pid) continue;

    let config;
    try {
      config = readServerInstanceConfig(serverName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[launcher-server-registry] skip ${serverName}: ${message}`);
      continue;
    }

    const httpPort = config.httpPort;
    if (httpPort == null || !Number.isFinite(httpPort)) continue;

    const joinUrl = buildAcstuffJoinUrl(httpPort);
    if (!joinUrl) continue;

    results.push({
      serverName,
      displayName: config.displayName || row.displayName?.trim() || serverName,
      type: row.type ?? 'unified',
      track: config.track,
      trackConfig: config.configTrack,
      cars: parseCarsField(config.cars),
      httpPort,
      udpPort: config.udpPort,
      maxClients: config.maxClients,
      playerCount: playerCountByFolder.get(serverName) ?? 0,
      hasPassword: config.password.length > 0,
      joinUrl,
      isRunning: true,
    });
  }

  return results.sort((a, b) => a.serverName.localeCompare(b.serverName));
}

export async function buildActiveLauncherServersWithRequiredContent(): Promise<LauncherServerEntry[]> {
  const servers = buildActiveLauncherServers();
  if (servers.length === 0) {
    return [];
  }

  return Promise.all(
    servers.map(async (server) => ({
      ...server,
      requiredContent: await buildRequiredContentForServer(server.cars, server.track),
    })),
  );
}
