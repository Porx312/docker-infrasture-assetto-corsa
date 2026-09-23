import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { isFleetModeEnabled, listFleetEdges } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
function contentBasePath(): string {
  return process.env.CONTENT_PATH || '/home/jose/assetto-install/assetto/content';
}

const execFileAsync = promisify(execFile);

export type ContentFleetSyncResult = {
  ok: boolean;
  dryRun: boolean;
  source: string;
  edges: Array<{ edgeId: string; label: string; status: 'ok' | 'skipped' | 'error'; message?: string }>;
};

function contentSyncEnabled(): boolean {
  return (process.env.CONTENT_FLEET_SYNC_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export async function syncContentToFleet(options?: { dryRun?: boolean }): Promise<ContentFleetSyncResult> {
  const dryRun = options?.dryRun === true;
  const source = path.resolve(contentBasePath());
  const edges = listFleetEdges();

  if (!isFleetModeEnabled() || edges.length === 0) {
    return {
      ok: false,
      dryRun,
      source,
      edges: [{ edgeId: '-', label: '-', status: 'error', message: 'Fleet mode not configured' }],
    };
  }

  if (!contentSyncEnabled()) {
    return {
      ok: false,
      dryRun,
      source,
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        label: edge.label,
        status: 'skipped',
        message: 'Set CONTENT_FLEET_SYNC_ENABLED=true to run rsync',
      })),
    };
  }

  const sshUser = (process.env.CONTENT_SYNC_SSH_USER || '').trim();
  const remotePath = (process.env.CONTENT_SYNC_REMOTE_PATH || '').trim();
  const rsyncBin = (process.env.CONTENT_SYNC_RSYNC_BIN || 'rsync').trim();

  if (!sshUser || !remotePath) {
    return {
      ok: false,
      dryRun,
      source,
      edges: edges.map((edge) => ({
        edgeId: edge.id,
        label: edge.label,
        status: 'skipped',
        message: 'CONTENT_SYNC_SSH_USER and CONTENT_SYNC_REMOTE_PATH required',
      })),
    };
  }

  const results: ContentFleetSyncResult['edges'] = [];

  for (const edge of edges) {
    const host = new URL(edge.baseUrl).hostname;
    const target = `${sshUser}@${host}:${remotePath.replace(/\/$/, '')}/`;
    const args = ['-az', '--delete', `${source}/`, target];
    if (dryRun) {
      args.splice(0, 0, '--dry-run');
    }

    try {
      await execFileAsync(rsyncBin, args, { timeout: 600_000 });
      results.push({ edgeId: edge.id, label: edge.label, status: 'ok' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ edgeId: edge.id, label: edge.label, status: 'error', message });
    }
  }

  return {
    ok: results.every((row) => row.status === 'ok'),
    dryRun,
    source,
    edges: results,
  };
}
