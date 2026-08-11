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

export function updateManagedServersFromSnapshot(rows: ManagedServerRow[]): void {
  byDisplayName.clear();
  for (const row of rows) {
    if (!row.serverName) {
      continue;
    }
    const displayName = row.displayName?.trim() || row.serverName;
    const entry: ManagedServer = {
      folderSlug: row.serverName,
      displayName,
      type: row.type ?? 'unified',
    };
    byDisplayName.set(displayKey(displayName), entry);
    byDisplayName.set(displayKey(row.serverName), entry);
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
