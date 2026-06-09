#!/usr/bin/env node
/**
 * Content Manager details sidecar for vanilla Kunos acServer.
 * Serves /api/details on the wrapper port (HTTP_PORT + offset) without spawning acServer.
 *
 * Usage:
 *   node scripts/cm-details-proxy.mjs /path/to/server/server
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverDir = process.argv[2];
if (!serverDir) {
  console.error('Usage: node cm-details-proxy.mjs <server-directory>');
  process.exit(1);
}

const cfgDir = path.join(serverDir, 'cfg');
const iniPath = path.join(cfgDir, 'server_cfg.ini');
const paramsPath = path.join(cfgDir, 'cm_wrapper_params.json');

function readIniValue(content, key) {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

const ini = fs.readFileSync(iniPath, 'utf8');
const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
const upstreamPort = Number(readIniValue(ini, 'HTTP_PORT'));
const listenPort = Number(params.port);
const description = params.description || '';
const loadingImageUrl = params.loadingImageUrl || '';

if (!upstreamPort || !listenPort) {
  console.error('Invalid HTTP_PORT or wrapper port');
  process.exit(1);
}

async function fetchInfo() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: upstreamPort, path: '/INFO', timeout: 3000 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('upstream timeout'));
    });
  });
}

function buildDetails(info) {
  const details = { ...info };
  details.description = description;
  details.wrappedPort = listenPort;
  if (loadingImageUrl) {
    details.loadingimageurl = loadingImageUrl;
  }
  details.poweredby = details.poweredby || 'ProjectD CM proxy';
  return details;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${listenPort}`);
  if (url.pathname !== '/api/details') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const info = await fetchInfo();
    const details = buildDetails(info);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(details));
  } catch (err) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(
    `[cm-proxy] ${path.basename(serverDir)} listening on :${listenPort} -> upstream :${upstreamPort}`,
  );
});
