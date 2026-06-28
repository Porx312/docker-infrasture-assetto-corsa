import { normalizeHudServerName } from './hudQueryNormalize.js';

export type ManagedServerType = 'time-attack' | 'battle' | string;

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
      type: row.type ?? 'time-attack',
    };
    byDisplayName.set(displayKey(displayName), entry);
    byDisplayName.set(displayKey(row.serverName), entry);
  }
}

export function lookupManagedServer(displayServerName: string): ManagedServer | null {
  const key = displayKey(displayServerName);
  return byDisplayName.get(key) ?? null;
}
