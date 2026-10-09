import { readCmWrapperPort } from '@projectd/ac-data-shared/controller/cmWrapper.js';
import { assertValidServerName, readServerInstanceConfig } from './serverInstanceConfig.js';
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

function wrapperOffset(): number {
  const raw = process.env.WRAPPER_PORT_OFFSET?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(parsed) ? parsed : 10_000;
}

/** Hub/local admin: port info from disk; running state requires edge proxy in fleet mode. */
export function getServerRuntime(serverName: string): ServerRuntimeInfo {
  assertValidServerName(serverName);
  const config = readServerInstanceConfig(serverName);
  const wrapperPort = readCmWrapperPort(serversPath(), serverName);

  return {
    serverName,
    running: false,
    pid: null,
    httpPort: config.httpPort,
    udpPort: config.udpPort,
    tcpPort: config.httpPort,
    wrapperPort: wrapperPort ?? (config.httpPort != null ? config.httpPort + wrapperOffset() : null),
  };
}
