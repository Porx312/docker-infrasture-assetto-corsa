import fs from 'fs';
import path from 'path';
import { activeServers, stopServerCore } from '../controller/controller.js';

const SERVERS_PATH = process.env.SERVERS_PATH || '';
const POOL_ENABLED =
  (process.env.SERVER_POOL_ENABLED || 'false').trim().toLowerCase() === 'true';
const IDLE_MINUTES = Math.max(
  1,
  Number(process.env.SERVER_POOL_IDLE_SHUTDOWN_MINUTES || '15'),
);
const TICK_MS = Math.max(
  30_000,
  Number(process.env.SERVER_POOL_TICK_MS || '60000'),
);

/** Last time we saw players > 0, keyed by folder slug (server-1). */
const lastActivityByFolder = new Map<string, number>();

/** displayName / folder slug -> folder slug */
let nameToFolder = new Map<string, string>();
let nameMapBuiltAt = 0;
const NAME_MAP_TTL_MS = 60_000;

function rebuildNameMap(): void {
  const now = Date.now();
  if (now - nameMapBuiltAt < NAME_MAP_TTL_MS) return;
  nameMapBuiltAt = now;
  const map = new Map<string, string>();

  if (!SERVERS_PATH || !fs.existsSync(SERVERS_PATH)) {
    nameToFolder = map;
    return;
  }

  for (const entry of fs.readdirSync(SERVERS_PATH, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('server')) continue;
    const folder = entry.name;
    map.set(folder, folder);
    const cfg = path.join(SERVERS_PATH, folder, 'cfg', 'server_cfg.ini');
    if (!fs.existsSync(cfg)) continue;
    try {
      const content = fs.readFileSync(cfg, 'utf-8');
      const nameM = /^NAME=(.+)/m.exec(content) || /^SERVER_NAME=(.+)/m.exec(content);
      if (nameM) {
        const display = nameM[1].trim();
        if (display) map.set(display.toLowerCase(), folder);
      }
    } catch {
      // ignore unreadable cfg
    }
  }
  nameToFolder = map;
}

export function resolveServerFolder(statusServerName: string): string | null {
  rebuildNameMap();
  const key = statusServerName.trim().toLowerCase();
  if (!key) return null;
  return nameToFolder.get(key) ?? (nameToFolder.has(statusServerName) ? statusServerName : null);
}

/** Called from redis bridge on server_status events. */
export function noteServerStatus(statusServerName: string, playerCount: number): void {
  if (!POOL_ENABLED) return;
  const folder = resolveServerFolder(statusServerName);
  if (!folder) return;
  if (playerCount > 0) {
    lastActivityByFolder.set(folder, Date.now());
  }
}

async function idleShutdownTick(): Promise<void> {
  if (!POOL_ENABLED) return;
  const idleMs = IDLE_MINUTES * 60_000;
  const now = Date.now();

  for (const [folder, info] of Object.entries(activeServers)) {
    if (!info?.pid) continue;
    const last = lastActivityByFolder.get(folder) ?? 0;
    if (last === 0) {
      // Running but never saw players via telemetry — treat start time as now (grace)
      lastActivityByFolder.set(folder, now);
      continue;
    }
    if (now - last < idleMs) continue;
    const result = await stopServerCore(folder);
    console.log(
      `[server-pool] idle shutdown ${folder} (${IDLE_MINUTES}m): ${result.ok ? 'ok' : result.message}`,
    );
    lastActivityByFolder.delete(folder);
  }
}

export function startServerPoolMonitor(): void {
  if (!POOL_ENABLED) {
    console.log('[server-pool] disabled (SERVER_POOL_ENABLED=false)');
    return;
  }
  console.log(
    `[server-pool] enabled idle=${IDLE_MINUTES}m tick=${TICK_MS}ms path=${SERVERS_PATH}`,
  );
  setInterval(() => {
    void idleShutdownTick().catch((err) => console.error('[server-pool] tick error:', err));
  }, TICK_MS);
}

export function isServerPoolMode(): boolean {
  return (process.env.SERVER_POOL_MODE || 'false').trim().toLowerCase() === 'true';
}

/** Pool mode: only explicit isActive===true may start processes from config snapshots. */
export function shouldStartFromConfig(isActive: boolean | undefined): boolean {
  if (!isServerPoolMode()) {
    return isActive !== false;
  }
  return isActive === true;
}
