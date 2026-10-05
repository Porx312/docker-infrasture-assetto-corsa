import fs from 'node:fs';
import path from 'node:path';
import { applyCmNameSuffix } from '../controller/cmWrapper.js';
import { derivePortsFromFolderName } from '../controller/serverPorts.js';
import { startServerCore } from '../controller/controller.js';
import { listServerInstanceNames } from './serverBranding.js';
import { getServerRuntime, serverBinaryExists, type ServerRuntimeInfo } from './serverRuntime.js';
import { readServerInstanceConfig } from './serverInstanceConfig.js';
import '../config/loadEnv.js';

function serversPath(): string {
  const value = process.env.SERVERS_PATH?.trim();
  if (!value) {
    throw new Error('SERVERS_PATH is not configured');
  }
  return value;
}

function repoRoot(): string {
  return path.dirname(serversPath());
}

function templateSourceDir(): string {
  const fromEnv = process.env.SERVER_TEMPLATE_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const candidate = path.join(repoRoot(), 'server-templates', 'server-template');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const fallback = path.join(serversPath(), 'server');
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  throw new Error('No server template found (server-templates/server-template or servers/server)');
}

function nextServerFolderName(): string {
  const names = listServerInstanceNames().filter((n) => n !== 'server-template');
  let maxN = 0;
  for (const name of names) {
    if (name === 'server') {
      maxN = Math.max(maxN, 0);
      continue;
    }
    const m = /^server-(\d+)$/.exec(name);
    if (m) {
      maxN = Math.max(maxN, Number.parseInt(m[1], 10));
    }
  }
  if (maxN === 0 && !names.includes('server')) {
    return 'server';
  }
  return `server-${maxN + 1}`;
}

/** Runtime dirs that must not be cloned from a dirty source (often mode 0000). */
const SKIP_COPY_DIR_NAMES = new Set(['results', 'logs']);

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // Template often has content/cars|tracks|weather as symlinks to shared dirs.
    // Dirent.isDirectory() is false for symlinks; copyFileSync would follow and throw EISDIR.
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      fs.symlinkSync(target, destPath);
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Exported for unit tests. */
export function copyDirRecursiveForTest(src: string, dest: string): void {
  copyDirRecursive(src, dest);
}

function patchIniField(content: string, field: string, value: string): string {
  const line = `${field}=${value}`;
  if (new RegExp(`^${field}=`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}=.*$`, 'm'), line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

function wrapperOffset(): number {
  const raw = process.env.WRAPPER_PORT_OFFSET?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(parsed) ? parsed : 10_000;
}

export type ProvisionServerResult = {
  message: string;
  server: {
    name: string;
    displayName: string | null;
    httpPort: number | null;
    wrapperPort: number | null;
  };
  runtime: ServerRuntimeInfo | null;
};

export async function provisionServerInstance(options: {
  displayName?: string;
  start?: boolean;
}): Promise<ProvisionServerResult> {
  const serverName = nextServerFolderName();
  const destDir = path.join(serversPath(), serverName);
  if (fs.existsSync(destDir)) {
    throw new Error(`Target already exists: ${serverName}`);
  }

  const sourceDir = templateSourceDir();
  copyDirRecursive(sourceDir, destDir);
  // Fresh empty results (never clone locked/mode-0000 results from source).
  fs.mkdirSync(path.join(destDir, 'results'), { recursive: true, mode: 0o775 });
  try {
    fs.chmodSync(path.join(destDir, 'results'), 0o775);
  } catch {
    /* best-effort */
  }

  const cfgPath = path.join(destDir, 'cfg', 'server_cfg.ini');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Template missing cfg/server_cfg.ini`);
  }

  const ports = derivePortsFromFolderName(serverName);
  if (!ports) {
    throw new Error(`Could not derive ports for ${serverName}`);
  }

  let instanceIndex = 0;
  if (serverName !== 'server') {
    const m = /^server-(\d+)$/.exec(serverName);
    instanceIndex = m ? Number.parseInt(m[1], 10) : 1;
  }
  const httpPort = 8081 + instanceIndex;
  const pluginListen = 12000 + instanceIndex * 10;
  const pluginLocal = pluginListen + 1;

  let ini = fs.readFileSync(cfgPath, 'utf-8');
  ini = patchIniField(ini, 'HTTP_PORT', String(httpPort));
  ini = patchIniField(ini, 'UDP_PORT', String(ports.udp));
  ini = patchIniField(ini, 'TCP_PORT', String(ports.tcp));
  ini = patchIniField(ini, 'UDP_PLUGIN_ADDRESS', `127.0.0.1:${pluginListen}`);
  ini = patchIniField(ini, 'UDP_PLUGIN_LOCAL_PORT', String(pluginLocal));

  const lobbyName = options.displayName?.trim() || `ProjectD ${serverName}`;
  const wrapperPort = httpPort + wrapperOffset();
  ini = patchIniField(ini, 'NAME', applyCmNameSuffix(lobbyName, wrapperPort));

  fs.writeFileSync(cfgPath, ini, 'utf-8');

  const wrapperPath = path.join(destDir, 'cfg', 'cm_wrapper_params.json');
  const wrapperData = {
    description: lobbyName,
    port: wrapperPort,
    verboseLog: false,
    downloadSpeedLimit: 0,
    downloadPasswordOnly: false,
    publishPasswordChecksum: true,
  };
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(wrapperPath, `${JSON.stringify(wrapperData, null, 2)}\n`, 'utf-8');

  let message = `Created ${serverName}`;
  if (options.start) {
    if (!serverBinaryExists(serverName)) {
      message += ' (binary missing — not started)';
    } else {
      const startResult = startServerCore(serverName);
      message += startResult.ok ? ` · ${startResult.message}` : ` · start failed: ${startResult.message}`;
    }
  }

  const config = readServerInstanceConfig(serverName);
  const runtime = options.start ? getServerRuntime(serverName) : null;

  return {
    message,
    server: {
      name: serverName,
      displayName: config.displayName,
      httpPort: config.httpPort,
      wrapperPort,
    },
    runtime,
  };
}
