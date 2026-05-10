import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  activeServers,
  applyServerConfiguration,
  restartServerCore,
  startServerCore,
  stopServerCore,
  type ServerConfigPayload,
} from './controller.js';

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function getServersPath(): string {
  const serversPath = process.env.SERVERS_PATH?.trim();
  if (!serversPath) {
    throw new Error('SERVERS_PATH no definido en .env');
  }
  return serversPath;
}

function availableServerNames(): string[] {
  const base = getServersPath();
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(base, name, 'acServer.exe')))
    .sort((a, b) => a.localeCompare(b));
}

export const getServers = (_req: Request, res: Response) => {
  try {
    const servers = availableServerNames().map((name) => ({
      serverName: name,
      isRunning: Boolean(activeServers[name]?.pid),
      pid: activeServers[name]?.pid ?? null,
    }));
    return res.json({ total: servers.length, servers });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
};

export const startServer = (req: Request, res: Response) => {
  const serverName = firstParam(req.params.serverName);
  if (!serverName) return res.status(400).json({ error: 'serverName es requerido' });
  const result = startServerCore(serverName);
  return res.status(result.ok ? 200 : 400).json(result);
};

export const stopServer = async (req: Request, res: Response) => {
  const serverName = firstParam(req.params.serverName);
  if (!serverName) return res.status(400).json({ error: 'serverName es requerido' });
  const result = await stopServerCore(serverName);
  return res.status(result.ok ? 200 : 400).json(result);
};

export const restartServer = async (req: Request, res: Response) => {
  const serverName = firstParam(req.params.serverName);
  if (!serverName) return res.status(400).json({ error: 'serverName es requerido' });
  const result = await restartServerCore(serverName);
  return res.status(result.ok ? 200 : 400).json(result);
};

export const configureServer = (req: Request, res: Response) => {
  const serverName = firstParam(req.params.serverName);
  if (!serverName) return res.status(400).json({ error: 'serverName es requerido' });
  const payload = (req.body ?? {}) as ServerConfigPayload;
  const result = applyServerConfiguration(serverName, payload);
  return res.status(result.ok ? 200 : 400).json(result);
};
