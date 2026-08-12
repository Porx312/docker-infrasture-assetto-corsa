import fs from 'node:fs';
import path from 'node:path';

import { stripCmNameSuffix } from '../../controller/cmWrapper.js';
import { normalizeHudServerName } from './hudQueryNormalize.js';

export type ManagedServerType = 'unified' | 'time-attack' | 'battle' | string;

export type ManagedServerRow = {
  serverName: string;
  displayName?: string;
  type?: ManagedServerType;
  instanceId?: string;
};

export type ManagedServer = {
  folderSlug: string;
  displayName: string;
  type: ManagedServerType;
};

const byDisplayName = new Map<string, ManagedServer>();

function displayKey(displayName: string): string {
  return normalizeHudServerName(displayName).toLowerCase();
}

export function resetManagedServersForTests(): void {
  byDisplayName.clear();
}

function inferServerType(folderSlug: string, displayName: string): ManagedServerType {
  const slug = folderSlug.toLowerCase();
  const name = displayName.toLowerCase();
  if (slug.includes('battle') || /\bbattle\b/.test(name)) {
    return 'battle';
  }
  if (slug.includes('time') || slug.includes('ta') || name.includes('time attack')) {
    return 'time-attack';
  }
  return 'unified';
}

function registerManagedServerRow(row: ManagedServerRow): void {
  if (!row.serverName) {
    return;
  }
  const displayName = row.displayName?.trim() || row.serverName;
  const entry: ManagedServer = {
    folderSlug: row.serverName,
    displayName,
    type: row.type ?? inferServerType(row.serverName, displayName),
  };
  byDisplayName.set(displayKey(displayName), entry);
  byDisplayName.set(displayKey(row.serverName), entry);
}

/** Register every local server folder (server_cfg.ini NAME) so HUD presence resolves before Convex sync. */
export function bootstrapManagedServersFromDisk(serversPath?: string): number {
  const root = serversPath?.trim() || process.env.SERVERS_PATH?.trim() || '';
  if (!root || !fs.existsSync(root)) {
    return 0;
  }

  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('server')) {
      continue;
    }
    const folder = entry.name;
    const cfgPath = path.join(root, folder, 'cfg', 'server_cfg.ini');
    if (!fs.existsSync(cfgPath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(cfgPath, 'utf-8');
      const nameMatch = /^NAME=(.+)/m.exec(content) || /^SERVER_NAME=(.+)/m.exec(content);
      if (!nameMatch) {
        continue;
      }
      const displayName = stripCmNameSuffix(nameMatch[1].trim());
      if (!displayName) {
        continue;
      }
      registerManagedServerRow({ serverName: folder, displayName });
      count += 1;
    } catch {
      // ignore unreadable cfg
    }
  }
  return count;
}

export function updateManagedServersFromSnapshot(rows: ManagedServerRow[]): void {
  byDisplayName.clear();
  bootstrapManagedServersFromDisk();
  for (const row of rows) {
    registerManagedServerRow(row);
  }
}

export function lookupManagedServer(displayServerName: string): ManagedServer | null {
  const key = displayKey(displayServerName);
  const direct = byDisplayName.get(key);
  if (direct) {
    return direct;
  }

  // Convex worker sync may truncate long displayName vs live server_cfg NAME (post-audit mismatch).
  let best: ManagedServer | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const [indexedKey, entry] of byDisplayName.entries()) {
    if (key.startsWith(indexedKey) || indexedKey.startsWith(key)) {
      const delta = Math.abs(key.length - indexedKey.length);
      if (delta < bestDelta) {
        best = entry;
        bestDelta = delta;
      }
    }
  }
  if (best && bestDelta <= 16) {
    return best;
  }

  return null;
}
