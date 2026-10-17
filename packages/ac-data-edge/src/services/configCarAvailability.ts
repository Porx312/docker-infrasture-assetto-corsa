/**
 * Local car availability for config apply — scan CONTENT_PATH (or SERVERS_PATH fallback)
 * and filter desired entries. Never strip entries silently in the applier; use
 * assertEntriesAvailable / resolveEntriesForApply instead.
 */
import fs from 'node:fs';
import path from 'node:path';

export type ConfigCarEntry = { model: string; skin?: string; count?: number };

/** True if car folder looks installed (slim, packed, or unpacked). */
export function isCarFolderAvailable(carPath: string): boolean {
  try {
    const st = fs.statSync(carPath);
    if (!st.isDirectory()) return false;
    const names = fs.readdirSync(carPath);
    if (names.some((f) => f.endsWith('.kn5'))) return true;
    if (names.includes('data.acd')) return true;
    if (names.includes('data') && fs.statSync(path.join(carPath, 'data')).isDirectory()) {
      return true;
    }
    if (names.includes('skins') && fs.statSync(path.join(carPath, 'skins')).isDirectory()) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve cars directory: prefer CONTENT_PATH/cars, else SERVERS_PATH/content/cars.
 * Does not throw if CONTENT_PATH unset — falls back so unit/tests without pool still work.
 */
export function resolveCarsContentDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const contentPath = (env.CONTENT_PATH || '').trim();
  if (contentPath) {
    return path.join(contentPath, 'cars');
  }
  const serversPath = (env.SERVERS_PATH || '').trim();
  if (serversPath) {
    return path.join(serversPath, 'content', 'cars');
  }
  return null;
}

export function scanAvailableCars(carsDir: string | null): Set<string> {
  const available = new Set<string>();
  if (!carsDir) return available;
  try {
    const entries = fs.readdirSync(carsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const carPath = path.join(carsDir, entry.name);
      if (isCarFolderAvailable(carPath)) {
        available.add(entry.name);
      }
    }
  } catch (err) {
    console.error('[config-car-availability] error scanning cars:', err);
  }
  return available;
}

export function getAvailableCars(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return scanAvailableCars(resolveCarsContentDir(env));
}

export function filterValidEntries(
  entries: ConfigCarEntry[],
  availableCars: Set<string>,
): { valid: ConfigCarEntry[]; missing: string[] } {
  if (!entries || entries.length === 0) {
    return { valid: [], missing: [] };
  }
  const valid: ConfigCarEntry[] = [];
  const missing: string[] = [];
  const seenMissing = new Set<string>();
  for (const e of entries) {
    if (availableCars.has(e.model)) {
      valid.push(e);
    } else if (!seenMissing.has(e.model)) {
      seenMissing.add(e.model);
      missing.push(e.model);
    }
  }
  return { valid, missing };
}

/**
 * Prepare entries for apply. Throws if desired entries exist but none are local —
 * caller must not apply name/track alone and leave stale CARS=/entry_list.
 */
export function resolveEntriesForApply(
  entries: ConfigCarEntry[] | undefined,
  availableCars: Set<string>,
  serverName: string,
): ConfigCarEntry[] | undefined {
  if (entries === undefined) return undefined;
  if (entries.length === 0) return [];

  const { valid, missing } = filterValidEntries(entries, availableCars);
  if (valid.length === 0) {
    throw new Error(
      `${serverName}: no valid cars locally: ${missing.join(', ') || '(empty models)'}`,
    );
  }
  if (missing.length > 0) {
    console.warn(
      `[config-car-availability] ${serverName} skipping cars not available locally: ${missing.join(', ')}`,
    );
  }
  return valid;
}
