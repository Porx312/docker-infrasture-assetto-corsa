import { lookupManagedServer } from './hud/hudManagedServers.js';
import { normalizeHudServerName } from './hud/hudQueryNormalize.js';
import { resolveServerFolder } from './serverPool.js';

const FOLDER_SLUG_RE = /^server(-\d+)?$/i;

/** Map Redis display name → Convex folder slug (server-4) for worker ingest. */
export function resolveIngestServerName(serverName: string | undefined): string | undefined {
  if (serverName === undefined) {
    return undefined;
  }
  const trimmed = serverName.trim();
  if (trimmed === '' || trimmed === '__config__') {
    return trimmed;
  }

  const normalized = normalizeHudServerName(trimmed);
  if (!normalized) {
    return undefined;
  }
  if (FOLDER_SLUG_RE.test(normalized)) {
    return normalized.toLowerCase();
  }

  const managed = lookupManagedServer(normalized);
  if (managed) {
    return managed.folderSlug;
  }

  const folder = resolveServerFolder(normalized);
  if (folder) {
    return folder;
  }

  return normalized;
}
