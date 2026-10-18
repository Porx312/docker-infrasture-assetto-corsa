import fs from 'node:fs';
import path from 'node:path';
import { applyCmNameSuffix } from '@projectd/ac-data-shared/controller/cmWrapper.js';
import { derivePortsFromFolderName } from '../controller/serverPorts.js';
import { stopServerCore } from '../controller/controller.js';
import { listServerInstanceNames } from '@projectd/ac-data-shared/services/serverBranding.js';
import { getServerRuntime, serverBinaryExists, type ServerRuntimeInfo } from './serverRuntime.js';
import { readServerInstanceConfig } from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
import '@projectd/ac-data-shared/config/loadEnv.js';

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

/**
 * Rewrite absolute symlink targets that hardcode another host's home
 * (e.g. /home/jose/assetto-infra/server → SERVERS_PATH when on /root).
 * `serversRoot` is SERVERS_PATH (the directory that contains acServer + server-N).
 */
export function rewriteAbsoluteSymlinkTarget(target: string, serversRoot: string): string {
  if (!target.startsWith('/')) {
    return target;
  }
  const root = path.resolve(serversRoot);
  const repoRootDir = path.dirname(root);
  const parentOfRepo = path.dirname(repoRootDir);
  const joseServers = '/home/jose/assetto-infra/server';
  const joseInfra = '/home/jose/assetto-infra';
  const joseInstall = '/home/jose/assetto-install';

  if (target === joseServers || target.startsWith(`${joseServers}/`)) {
    const rest = target.slice(joseServers.length).replace(/^\//, '');
    return rest ? path.join(root, rest) : root;
  }
  if (target === joseInfra || target.startsWith(`${joseInfra}/`)) {
    const rest = target.slice(joseInfra.length).replace(/^\//, '');
    return rest ? path.join(repoRootDir, rest) : repoRootDir;
  }
  if (target === joseInstall || target.startsWith(`${joseInstall}/`)) {
    const rest = target.slice(joseInstall.length).replace(/^\//, '');
    return rest
      ? path.join(parentOfRepo, 'assetto-install', rest)
      : path.join(parentOfRepo, 'assetto-install');
  }
  if (target.startsWith('/home/jose/')) {
    return path.join(parentOfRepo, target.slice('/home/jose/'.length));
  }
  return target;
}

function unlinkIfPresent(filePath: string): void {
  try {
    fs.lstatSync(filePath);
    fs.unlinkSync(filePath);
  } catch {
    /* missing */
  }
}

function pathExistsOrSymlink(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force portable relative links for acServer / system inside an instance folder.
 * Relative ../acServer works on /home/jose and /root without rewrites.
 */
export function ensureInstanceLinks(destDir: string, serversRoot?: string): void {
  const root = path.resolve(serversRoot ?? serversPath());
  const dest = path.resolve(destDir);
  const relAc = path.relative(dest, path.join(root, 'acServer')) || '../acServer';
  const acLink = path.join(dest, 'acServer');
  unlinkIfPresent(acLink);
  fs.symlinkSync(relAc, acLink);

  const systemSrc = path.join(root, 'system');
  if (pathExistsOrSymlink(systemSrc)) {
    const relSys = path.relative(dest, systemSrc) || '../system';
    const sysLink = path.join(dest, 'system');
    unlinkIfPresent(sysLink);
    fs.symlinkSync(relSys, sysLink);
  }
}

function copyDirRecursive(src: string, dest: string, serversRoot?: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const rootForRewrite =
    serversRoot ??
    (process.env.SERVERS_PATH?.trim() ? path.resolve(process.env.SERVERS_PATH.trim()) : undefined);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // Template often has content/cars|tracks|weather as symlinks to shared dirs.
    // Dirent.isDirectory() is false for symlinks; copyFileSync would follow and throw EISDIR.
    if (entry.isSymbolicLink()) {
      const raw = fs.readlinkSync(srcPath);
      const target = rootForRewrite
        ? rewriteAbsoluteSymlinkTarget(raw, rootForRewrite)
        : raw;
      fs.symlinkSync(target, destPath);
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, rootForRewrite);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Exported for unit tests. */
export function copyDirRecursiveForTest(
  src: string,
  dest: string,
  serversRoot?: string,
): void {
  copyDirRecursive(src, dest, serversRoot);
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
  ensureInstanceLinks(destDir);
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
      const { startServerWithMods } = await import('./modAgent/startGate.js');
      const startResult = await startServerWithMods(serverName);
      if (startResult.ok) {
        message += ` · ${startResult.message}`;
      } else if (startResult.code === 'MODS_NOT_READY') {
        message += ` · start blocked (mods not ready): ${(startResult.missing || [])
          .map((m) => m.acContentSlug)
          .join(', ')}`;
      } else {
        message += ` · start failed: ${startResult.message}`;
      }
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

const SAFE_SERVER_FOLDER = /^(server|server-\d+)$/;

export type DeprovisionServerResult = {
  message: string;
  serverName: string;
  stopped: boolean;
};

/**
 * Stop (if running) and delete a provisioned server folder under SERVERS_PATH.
 * Rejects path traversal and non-instance folders (e.g. server-template).
 */
export async function deprovisionServerInstance(
  rawName: string,
): Promise<DeprovisionServerResult> {
  const serverName = rawName.trim();
  if (!SAFE_SERVER_FOLDER.test(serverName)) {
    throw new Error(`Invalid server name: ${serverName || '(empty)'}`);
  }

  const root = path.resolve(serversPath());
  const destDir = path.resolve(root, serverName);
  if (destDir !== root && !destDir.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid server path');
  }
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    throw new Error(`Server instance not found: ${serverName}`);
  }

  let wasRunning = false;
  try {
    const stopResult = await stopServerCore(serverName);
    wasRunning = stopResult.ok;
    // ok:false with "no estaba activo" / not active = already stopped — fine to delete
  } catch {
    /* best-effort stop before delete */
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  if (fs.existsSync(destDir)) {
    throw new Error(`Failed to remove ${serverName}`);
  }

  return {
    message: wasRunning
      ? `Stopped and removed ${serverName}`
      : `Removed ${serverName}`,
    serverName,
    stopped: wasRunning,
  };
}
