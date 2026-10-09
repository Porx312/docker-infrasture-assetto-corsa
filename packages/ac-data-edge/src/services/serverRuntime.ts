import fs from 'node:fs';
import path from 'node:path';
import { activeServers } from '../controller/controller.js';
import { readCmWrapperPort } from '@projectd/ac-data-shared/controller/cmWrapper.js';
import { getServerPorts } from '../controller/serverPorts.js';
import { assertValidServerName, readServerInstanceConfig } from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
import '@projectd/ac-data-shared/config/loadEnv.js';

export type ServerRuntimeInfo = {
  serverName: string;
  running: boolean;
  pid: number | null;
  httpPort: number | null;
  udpPort: number | null;
  tcpPort: number | null;
  wrapperPort: number | null;
};

function serversPath(): string {
  const value = process.env.SERVERS_PATH?.trim();
  if (!value) {
    throw new Error('SERVERS_PATH is not configured');
  }
  return value;
}

export function getServerRuntime(serverName: string): ServerRuntimeInfo {
  assertValidServerName(serverName);
  const config = readServerInstanceConfig(serverName);
  const gamePorts = getServerPorts(serversPath(), serverName);
  const wrapperPort = readCmWrapperPort(serversPath(), serverName);
  const active = activeServers[serverName];

  return {
    serverName,
    running: Boolean(active?.pid),
    pid: active?.pid ?? null,
    httpPort: config.httpPort,
    udpPort: gamePorts?.udp ?? config.udpPort,
    tcpPort: gamePorts?.tcp ?? config.httpPort,
    wrapperPort: wrapperPort ?? (config.httpPort != null ? config.httpPort + wrapperOffset() : null),
  };
}

function wrapperOffset(): number {
  const raw = process.env.WRAPPER_PORT_OFFSET?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(parsed) ? parsed : 10_000;
}

export function serverBinaryExists(serverName: string): boolean {
  assertValidServerName(serverName);
  const base = path.join(serversPath(), serverName);
  return fs.existsSync(path.join(base, 'acServer')) || fs.existsSync(path.join(base, 'acServer.exe'));
}
