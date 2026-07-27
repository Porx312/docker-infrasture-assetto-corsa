import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { applyCmNameSuffix, readCmWrapperPort, stripCmNameSuffix } from '../controller/cmWrapper.js';
import { buildCmDescription, type ServerBranding } from './serverBranding.js';
import '../config/loadEnv.js';

const execFileAsync = promisify(execFile);

export interface ServerInstanceConfig {
  serverName: string;
  displayName: string;
  password: string;
  maxClients: number;
  cars: string;
  track: string;
  configTrack: string;
  description: string;
  webLink: string;
  cmDescriptionBody: string;
  bannerImageUrl: string;
  loadingImageUrl: string;
  httpPort: number | null;
  udpPort: number | null;
  registerToLobby: boolean;
}

const SERVER_NAME_PATTERN = /^server(-\d+)?$/;

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

export function assertValidServerName(serverName: string): void {
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error('Invalid server name');
  }
}

function cfgIniPath(serverName: string): string {
  assertValidServerName(serverName);
  return path.join(serversPath(), serverName, 'cfg', 'server_cfg.ini');
}

function wrapperJsonPath(serverName: string): string {
  assertValidServerName(serverName);
  return path.join(serversPath(), serverName, 'cfg', 'cm_wrapper_params.json');
}

function readIniField(content: string, field: string): string | null {
  const match = new RegExp(`^${field}=(.*)$`, 'm').exec(content);
  return match ? match[1].trim() : null;
}

function patchIniField(content: string, field: string, value: string): string {
  const line = `${field}=${value}`;
  if (new RegExp(`^${field}=`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}=.*$`, 'm'), line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

export function parseCmDescription(description: string): { bannerImageUrl: string; body: string } {
  const match = /^\[img=([^\]]+)\]ProjectD\[\/img\]\n\n([\s\S]*)$/.exec(description.trim());
  if (match) {
    return { bannerImageUrl: match[1], body: match[2] };
  }
  return { bannerImageUrl: '', body: description.trim() };
}

export function readServerInstanceConfig(serverName: string): ServerInstanceConfig {
  const cfgPath = cfgIniPath(serverName);
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Config not found for ${serverName}`);
  }

  const ini = fs.readFileSync(cfgPath, 'utf-8');
  const wrapperPath = wrapperJsonPath(serverName);
  let cmDescriptionBody = '';
  let bannerImageUrl = '';
  let loadingImageUrl = '';

  if (fs.existsSync(wrapperPath)) {
    const wrapper = JSON.parse(fs.readFileSync(wrapperPath, 'utf-8')) as {
      description?: string;
      loadingImageUrl?: string;
    };
    const parsed = parseCmDescription(wrapper.description ?? '');
    cmDescriptionBody = parsed.body;
    bannerImageUrl = parsed.bannerImageUrl;
    loadingImageUrl = wrapper.loadingImageUrl ?? parsed.bannerImageUrl;
  }

  const httpPortRaw = readIniField(ini, 'HTTP_PORT');
  const udpPortRaw = readIniField(ini, 'UDP_PORT');
  const maxClientsRaw = readIniField(ini, 'MAX_CLIENTS');
  const registerRaw = readIniField(ini, 'REGISTER_TO_LOBBY');

  return {
    serverName,
    displayName: stripCmNameSuffix(readIniField(ini, 'NAME') ?? ''),
    password: readIniField(ini, 'PASSWORD') ?? '',
    maxClients: maxClientsRaw ? Number.parseInt(maxClientsRaw, 10) || 0 : 0,
    cars: readIniField(ini, 'CARS') ?? '',
    track: readIniField(ini, 'TRACK') ?? '',
    configTrack: readIniField(ini, 'CONFIG_TRACK') ?? '',
    description: readIniField(ini, 'DESCRIPTION') ?? '',
    webLink: readIniField(ini, 'WEBLINK') ?? '',
    cmDescriptionBody,
    bannerImageUrl,
    loadingImageUrl,
    httpPort: httpPortRaw ? Number.parseInt(httpPortRaw, 10) : null,
    udpPort: udpPortRaw ? Number.parseInt(udpPortRaw, 10) : null,
    registerToLobby: registerRaw === '1',
  };
}

export async function updateServerInstanceConfig(
  serverName: string,
  input: Partial<ServerInstanceConfig>,
): Promise<ServerInstanceConfig> {
  const cfgPath = cfgIniPath(serverName);
  let ini = fs.readFileSync(cfgPath, 'utf-8');

  if (input.displayName !== undefined) {
    const wrapperPort = readCmWrapperPort(serversPath(), serverName);
    const nameValue = applyCmNameSuffix(input.displayName.trim(), wrapperPort);
    ini = patchIniField(ini, 'NAME', nameValue);
  }
  if (input.password !== undefined) {
    ini = patchIniField(ini, 'PASSWORD', input.password);
  }
  if (input.maxClients !== undefined) {
    ini = patchIniField(ini, 'MAX_CLIENTS', String(Math.max(1, input.maxClients)));
  }
  if (input.cars !== undefined) {
    ini = patchIniField(ini, 'CARS', input.cars.trim());
  }
  if (input.track !== undefined) {
    ini = patchIniField(ini, 'TRACK', input.track.trim());
  }
  if (input.configTrack !== undefined) {
    ini = patchIniField(ini, 'CONFIG_TRACK', input.configTrack.trim());
  }
  if (input.description !== undefined) {
    ini = patchIniField(ini, 'DESCRIPTION', input.description.trim());
  }
  if (input.webLink !== undefined) {
    ini = patchIniField(ini, 'WEBLINK', input.webLink.trim());
  }
  if (input.registerToLobby !== undefined) {
    ini = patchIniField(ini, 'REGISTER_TO_LOBBY', input.registerToLobby ? '1' : '0');
  }

  fs.writeFileSync(cfgPath, ini, 'utf-8');

  const brandingTouched =
    input.description !== undefined ||
    input.webLink !== undefined ||
    input.cmDescriptionBody !== undefined ||
    input.bannerImageUrl !== undefined ||
    input.loadingImageUrl !== undefined;

  if (brandingTouched) {
    const current = readServerInstanceConfig(serverName);
    const branding: ServerBranding = {
      description: input.description ?? current.description,
      webLink: input.webLink ?? current.webLink,
      cmDescriptionBody: input.cmDescriptionBody ?? current.cmDescriptionBody,
      bannerImageUrl: input.bannerImageUrl ?? current.bannerImageUrl,
      loadingImageUrl: input.loadingImageUrl ?? current.loadingImageUrl,
    };

    const wrapperPath = wrapperJsonPath(serverName);
    const existing = fs.existsSync(wrapperPath)
      ? (JSON.parse(fs.readFileSync(wrapperPath, 'utf-8')) as Record<string, unknown>)
      : {};

    const httpPortRaw = readIniField(ini, 'HTTP_PORT');
    const httpPort = httpPortRaw ? Number.parseInt(httpPortRaw, 10) : NaN;
    const offset = Number.parseInt(process.env.WRAPPER_PORT_OFFSET ?? '10000', 10) || 10_000;
    const wrapperPort =
      typeof existing.port === 'number'
        ? existing.port
        : Number.isFinite(httpPort)
          ? httpPort + offset
          : null;

    const wrapperData: Record<string, unknown> = {
      ...existing,
      description: buildCmDescription(branding),
      port: wrapperPort ?? existing.port,
    };
    if (branding.loadingImageUrl) {
      wrapperData.loadingImageUrl = branding.loadingImageUrl;
    } else {
      delete wrapperData.loadingImageUrl;
    }

    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, `${JSON.stringify(wrapperData, null, 2)}\n`, 'utf-8');
    await restartCmProxyForServer(serverName);
  }

  return readServerInstanceConfig(serverName);
}

export async function restartCmProxyForServer(serverName: string): Promise<void> {
  assertValidServerName(serverName);
  const root = repoRoot();
  const pidDir = path.join(serversPath(), 'shared', 'cm-proxy-pids');
  const logDir = path.join(serversPath(), 'shared', 'cm-proxy-logs');
  const pidFile = path.join(pidDir, `${serverName}.pid`);
  const proxyJs = path.join(root, 'scripts', 'cm-details-proxy.mjs');
  const serverDir = path.join(serversPath(), serverName);

  fs.mkdirSync(pidDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  if (fs.existsSync(pidFile)) {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already stopped
      }
    }
    fs.unlinkSync(pidFile);
  }

  const paramsPath = path.join(serverDir, 'cfg', 'cm_wrapper_params.json');
  if (!fs.existsSync(paramsPath) || !fs.existsSync(proxyJs)) {
    return;
  }

  const logPath = path.join(logDir, `${serverName}.log`);
  const out = fs.openSync(logPath, 'a');
  const child = spawn('node', [proxyJs, serverDir], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf-8');
}
