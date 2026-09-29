import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listServerInstanceNames } from '../serverBranding.js';
import { getServerRuntime } from '../serverRuntime.js';

const execFileAsync = promisify(execFile);

export type EdgeProcessSample = {
  name: string;
  kind: 'acServer' | 'cm-proxy' | 'orphan';
  pid: number;
  rssBytes: number;
  cpuPct: number | null;
  cmdline?: string;
};

type CpuSample = { jiffies: number; atMs: number };

/** Previous CPU jiffies per pid for delta % between heartbeats. */
const prevCpuByPid = new Map<number, CpuSample>();

const MAX_PROCESSES = 50;
const CLK_TCK = (() => {
  try {
    // Node doesn't expose sysconf; Linux default is 100.
    return 100;
  } catch {
    return 100;
  }
})();

function serversPath(): string | null {
  const value = process.env.SERVERS_PATH?.trim();
  return value || null;
}

function readPidFile(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    fs.accessSync(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

function readRssBytes(pid: number): number | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    if (!match?.[1]) return null;
    return Number.parseInt(match[1], 10) * 1024;
  } catch {
    return null;
  }
}

/** utime + stime from /proc/pid/stat (fields 14 and 15 after comm). */
function readCpuJiffies(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const closeParen = stat.lastIndexOf(')');
    if (closeParen < 0) return null;
    const rest = stat.slice(closeParen + 2).split(/\s+/);
    const utime = Number.parseInt(rest[11] ?? '', 10);
    const stime = Number.parseInt(rest[12] ?? '', 10);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}

function readCmdline(pid: number): string | undefined {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    const text = raw.replace(/\0/g, ' ').trim();
    return text ? text.slice(0, 120) : undefined;
  } catch {
    return undefined;
  }
}

function cpuPctForPid(pid: number, jiffies: number, nowMs: number): number | null {
  const prev = prevCpuByPid.get(pid);
  prevCpuByPid.set(pid, { jiffies, atMs: nowMs });
  if (!prev || nowMs <= prev.atMs) return null;
  const elapsedSec = (nowMs - prev.atMs) / 1000;
  if (elapsedSec < 0.2) return null;
  const deltaJiffies = jiffies - prev.jiffies;
  if (deltaJiffies < 0) return null;
  const cpuSec = deltaJiffies / CLK_TCK;
  const pct = (cpuSec / elapsedSec) * 100;
  return Math.round(Math.max(0, Math.min(100 * os.cpus().length, pct)) * 10) / 10;
}

function samplePid(
  name: string,
  kind: EdgeProcessSample['kind'],
  pid: number,
  nowMs: number,
): EdgeProcessSample | null {
  if (!pidAlive(pid)) {
    prevCpuByPid.delete(pid);
    return null;
  }
  const rssBytes = readRssBytes(pid);
  if (rssBytes == null) return null;
  const jiffies = readCpuJiffies(pid);
  const cpuPct = jiffies != null ? cpuPctForPid(pid, jiffies, nowMs) : null;
  return {
    name,
    kind,
    pid,
    rssBytes,
    cpuPct,
    cmdline: readCmdline(pid),
  };
}

async function listAcServerPidsViaPgrep(): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', 'acServer'], { encoding: 'utf-8' });
    return stdout
      .split(/\s+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** Collect live AC / CM-proxy process samples for fleet capacity UI. */
export async function collectProcessSamples(): Promise<EdgeProcessSample[]> {
  const nowMs = Date.now();
  /** @type {Map<number, EdgeProcessSample>} */
  const byPid = new Map<number, EdgeProcessSample>();
  const knownPids = new Set<number>();

  const names = (() => {
    try {
      return listServerInstanceNames().filter((n) => n !== 'server-template');
    } catch {
      return [];
    }
  })();

  const root = serversPath();
  for (const name of names) {
    try {
      const runtime = getServerRuntime(name);
      if (runtime.pid) {
        knownPids.add(runtime.pid);
        const sample = samplePid(name, 'acServer', runtime.pid, nowMs);
        if (sample) byPid.set(sample.pid, sample);
      }
    } catch {
      /* ignore */
    }

    if (root) {
      const proxyPid = readPidFile(path.join(root, 'shared', 'cm-proxy-pids', `${name}.pid`));
      if (proxyPid) {
        knownPids.add(proxyPid);
        const sample = samplePid(`cm-proxy:${name}`, 'cm-proxy', proxyPid, nowMs);
        if (sample) byPid.set(sample.pid, sample);
      }
    }
  }

  for (const pid of await listAcServerPidsViaPgrep()) {
    if (knownPids.has(pid) || byPid.has(pid)) continue;
    const sample = samplePid(`orphan:${pid}`, 'orphan', pid, nowMs);
    if (sample) byPid.set(sample.pid, sample);
  }

  // Drop stale CPU samples for dead pids
  for (const pid of [...prevCpuByPid.keys()]) {
    if (!byPid.has(pid)) prevCpuByPid.delete(pid);
  }

  return [...byPid.values()]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, MAX_PROCESSES);
}
