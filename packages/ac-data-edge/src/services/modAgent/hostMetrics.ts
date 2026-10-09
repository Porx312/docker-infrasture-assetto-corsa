import os from 'node:os';
import { listServerInstanceNames } from '@projectd/ac-data-shared/services/serverBranding.js';
import { getServerRuntime } from '../serverRuntime.js';
import { collectProcessSamples, type EdgeProcessSample } from './processMetrics.js';

export type ModAgentHostMetrics = {
  diskFreeBytes?: number;
  diskTotalBytes?: number;
  cpuCount?: number;
  load1?: number;
  memTotalBytes?: number;
  memFreeBytes?: number;
  serversTotal?: number;
  serversRunning?: number;
  processes?: EdgeProcessSample[];
};

async function diskStats(): Promise<{ free?: number; total?: number }> {
  try {
    const { statfs } = await import('node:fs/promises');
    const root = process.env.AC_MOD_ROOT || process.env.SERVERS_PATH || '/var/lib/ac-mods';
    const stat = await statfs(root);
    const bsize = Number(stat.bsize);
    return {
      free: Number(stat.bfree) * bsize,
      total: Number(stat.blocks) * bsize,
    };
  } catch {
    return {};
  }
}

function serverCounts(): { total: number; running: number } {
  try {
    const names = listServerInstanceNames().filter((n) => n !== 'server-template');
    let running = 0;
    for (const name of names) {
      try {
        if (getServerRuntime(name).running) running += 1;
      } catch {
        /* ignore per-server errors */
      }
    }
    return { total: names.length, running };
  } catch {
    return { total: 0, running: 0 };
  }
}

/** Collect host + AC server snapshot for mod-agent heartbeat. */
export async function collectHostMetrics(): Promise<ModAgentHostMetrics> {
  const disk = await diskStats();
  const servers = serverCounts();
  const load = os.loadavg();
  const processes = await collectProcessSamples();
  return {
    diskFreeBytes: disk.free,
    diskTotalBytes: disk.total,
    cpuCount: os.cpus().length,
    load1: typeof load[0] === 'number' ? load[0] : undefined,
    memTotalBytes: os.totalmem(),
    memFreeBytes: os.freemem(),
    serversTotal: servers.total,
    serversRunning: servers.running,
    processes,
  };
}
