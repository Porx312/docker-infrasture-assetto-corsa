import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { activeServers } from '../controller/controller.js';
import {
  buildAcstuffJoinUrl,
  buildActiveLauncherServers,
  buildActiveLauncherServersWithRequiredContent,
  parseCarsField,
  resetLauncherServerRegistryForTests,
  updateLauncherServerSnapshot,
  noteLauncherServerPlayerCount,
} from './launcherServerRegistry.js';

const originalEnv = {
  SERVER_POOL_MODE: process.env.SERVER_POOL_MODE,
  LAUNCHER_AC_HOST: process.env.LAUNCHER_AC_HOST,
  SERVERS_PATH: process.env.SERVERS_PATH,
  AC_INSTANCE_ID: process.env.AC_INSTANCE_ID,
  CONTENT_PATH: process.env.CONTENT_PATH,
};

let tempServersPath: string | null = null;

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writeServerIni(
  serverName: string,
  fields: Record<string, string | number>,
): void {
  if (!tempServersPath) {
    throw new Error('tempServersPath not initialized');
  }
  const cfgDir = path.join(tempServersPath, serverName, 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(path.join(cfgDir, 'server_cfg.ini'), `${lines.join('\n')}\n`, 'utf-8');
}

function setRunning(serverName: string, running: boolean): void {
  if (running) {
    activeServers[serverName] = {
      pid: 4242,
      process: {} as import('node:child_process').ChildProcess,
    };
  } else {
    delete activeServers[serverName];
  }
}

afterEach(() => {
  resetLauncherServerRegistryForTests();
  for (const key of Object.keys(activeServers)) {
    delete activeServers[key];
  }
  if (tempServersPath && fs.existsSync(tempServersPath)) {
    fs.rmSync(tempServersPath, { recursive: true, force: true });
    tempServersPath = null;
  }
  restoreEnv();
});

test('parseCarsField splits semicolon-separated car ids', () => {
  assert.deepEqual(parseCarsField('a;b; c '), ['a', 'b', 'c']);
  assert.deepEqual(parseCarsField(''), []);
});

test('buildAcstuffJoinUrl encodes host and port', () => {
  process.env.LAUNCHER_AC_HOST = '13.140.160.131';
  assert.equal(
    buildAcstuffJoinUrl(8081),
    'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8081',
  );
  delete process.env.LAUNCHER_AC_HOST;
  assert.equal(buildAcstuffJoinUrl(8081), null);
});

test('buildActiveLauncherServers excludes inactive snapshot rows', () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-servers-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.LAUNCHER_AC_HOST = '127.0.0.1';
  delete process.env.SERVER_POOL_MODE;

  writeServerIni('server', {
    NAME: 'ProjectD Test',
    TRACK: 'pk_akina',
    CONFIG_TRACK: '',
    CARS: 'ks_toyota_gt86;ks_mazda_mx5',
    HTTP_PORT: 8081,
    UDP_PORT: 9600,
    MAX_CLIENTS: 16,
    PASSWORD: '',
  });

  updateLauncherServerSnapshot([{ serverName: 'server', isActive: false }]);
  setRunning('server', true);

  assert.deepEqual(buildActiveLauncherServers(), []);
});

test('buildActiveLauncherServers excludes servers without running process', () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-servers-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.LAUNCHER_AC_HOST = '127.0.0.1';

  writeServerIni('server', {
    NAME: 'ProjectD Test',
    TRACK: 'pk_akina',
    CARS: 'ks_toyota_gt86',
    HTTP_PORT: 8081,
    MAX_CLIENTS: 16,
  });

  updateLauncherServerSnapshot([{ serverName: 'server', isActive: true, type: 'battle' }]);
  setRunning('server', false);

  assert.deepEqual(buildActiveLauncherServers(), []);
});

test('buildActiveLauncherServers returns joinable entry when active and running', () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-servers-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.LAUNCHER_AC_HOST = '13.140.160.131';

  writeServerIni('server', {
    NAME: 'ProjectD #1',
    TRACK: 'ks_nordschleife',
    CONFIG_TRACK: 'touristenfahrten',
    CARS: 'ks_toyota_gt86',
    HTTP_PORT: 8081,
    UDP_PORT: 9600,
    MAX_CLIENTS: 16,
    PASSWORD: 'secret',
  });

  updateLauncherServerSnapshot([
    { serverName: 'server', isActive: true, type: 'unified', displayName: 'Fallback Name' },
  ]);
  setRunning('server', true);
  noteLauncherServerPlayerCount('server', 2);

  const items = buildActiveLauncherServers();
  assert.equal(items.length, 1);
  const entry = items[0]!;
  assert.equal(entry.serverName, 'server');
  assert.equal(entry.displayName, 'ProjectD #1');
  assert.equal(entry.type, 'unified');
  assert.equal(entry.track, 'ks_nordschleife');
  assert.equal(entry.trackConfig, 'touristenfahrten');
  assert.deepEqual(entry.cars, ['ks_toyota_gt86']);
  assert.equal(entry.httpPort, 8081);
  assert.equal(entry.playerCount, 2);
  assert.equal(entry.hasPassword, true);
  assert.equal(
    entry.joinUrl,
    'https://acstuff.club/s/q:race/online/join?ip=13.140.160.131&httpPort=8081',
  );
  assert.equal(entry.isRunning, true);
});

test('buildActiveLauncherServers requires explicit isActive in pool mode', () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-servers-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.LAUNCHER_AC_HOST = '127.0.0.1';
  process.env.SERVER_POOL_MODE = 'true';

  writeServerIni('server-1', {
    NAME: 'Pool Server',
    TRACK: 'pk_akina',
    CARS: 'ks_toyota_gt86',
    HTTP_PORT: 8082,
    MAX_CLIENTS: 8,
  });

  updateLauncherServerSnapshot([{ serverName: 'server-1', isActive: undefined }]);
  setRunning('server-1', true);
  assert.deepEqual(buildActiveLauncherServers(), []);

  updateLauncherServerSnapshot([{ serverName: 'server-1', isActive: true }]);
  assert.equal(buildActiveLauncherServers().length, 1);
});

test('updateLauncherServerSnapshot filters by instanceId', () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-servers-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.LAUNCHER_AC_HOST = '127.0.0.1';
  process.env.AC_INSTANCE_ID = 'vps-a';

  writeServerIni('server', {
    NAME: 'Local',
    TRACK: 'pk_akina',
    CARS: 'a',
    HTTP_PORT: 8081,
    MAX_CLIENTS: 8,
  });
  writeServerIni('server-1', {
    NAME: 'Remote',
    TRACK: 'pk_akina',
    CARS: 'b',
    HTTP_PORT: 8082,
    MAX_CLIENTS: 8,
  });

  updateLauncherServerSnapshot([
    { serverName: 'server', isActive: true, instanceId: 'vps-a' },
    { serverName: 'server-1', isActive: true, instanceId: 'vps-b' },
  ]);
  setRunning('server', true);
  setRunning('server-1', true);

  const items = buildActiveLauncherServers();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.serverName, 'server');
});

test('buildActiveLauncherServersWithRequiredContent attaches per-server mods only', async () => {
  tempServersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-required-'));
  const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'content-required-'));
  process.env.SERVERS_PATH = tempServersPath;
  process.env.CONTENT_PATH = contentRoot;
  process.env.LAUNCHER_AC_HOST = '127.0.0.1';

  const carDir = path.join(contentRoot, 'cars', 'ks_toyota_gt86');
  fs.mkdirSync(carDir, { recursive: true });
  fs.writeFileSync(path.join(carDir, 'data.acd'), 'acd', 'utf-8');

  const trackDir = path.join(contentRoot, 'tracks', 'pk_akina');
  fs.mkdirSync(trackDir, { recursive: true });
  fs.writeFileSync(path.join(trackDir, 'data.acd'), 'acd', 'utf-8');

  writeServerIni('server', {
    NAME: 'Akina Server',
    TRACK: 'pk_akina',
    CARS: 'ks_toyota_gt86',
    HTTP_PORT: 8081,
    MAX_CLIENTS: 16,
  });

  updateLauncherServerSnapshot([{ serverName: 'server', isActive: true }]);
  setRunning('server', true);

  const items = await buildActiveLauncherServersWithRequiredContent();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.requiredContent.cars.length, 1);
  assert.equal(items[0]?.requiredContent.cars[0]?.name, 'ks_toyota_gt86');
  assert.equal(items[0]?.requiredContent.track?.name, 'pk_akina');
  assert.ok(!('contentHints' in (items[0] ?? {})));
});
