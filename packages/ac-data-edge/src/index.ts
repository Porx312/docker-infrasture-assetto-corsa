import '@projectd/ac-data-shared/config/loadEnv.js';
import { assertFleetBootGuards } from '@projectd/ac-data-shared/services/fleet/fleetBootGuards.js';
import { assertSecurityConfiguration } from './config/securityStartup.js';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import adminRoutes from './routes/adminRoutes.js';
import acServerRoutes from './routes/acServerRoutes.js';
import hudRoutes from './routes/hudRoutes.js';
import { hudMiddleware } from './middleware/hudMiddleware.js';
import { initHudPushHub } from './services/hud/battleHudPush.js';
import { startHudConvexQueryStatsLogging } from './services/hud/hudConvexQueryStats.js';
import { startRedisConvexBridge } from './services/redisConvexBridge.js';
import { startRedisConfigApplier } from './services/redisConfigApplier.js';
import { bootstrapManagedServersFromDisk } from './services/hud/hudManagedServers.js';
import { publishHudRegistryToHubIfConfigured } from './services/hud/edgeHudRegistryPublish.js';
import { startServerPoolMonitor } from './services/serverPool.js';
import {
  getPublicHealthHandler,
  getPublicLiveHandler,
} from '@projectd/ac-data-shared/controller/healthController.js';
import { resolveEnvFilePath } from '@projectd/ac-data-shared/config/loadEnv.js';
import { installFatalProcessHandlers } from '@projectd/ac-data-shared/services/fatalProcessHandlers.js';
import { attachHudWs } from './services/hud/hudWs.js';
import { isBackendIngestForwardConfigured } from '@projectd/ac-data-shared/services/edgeIngestForward.js';
import { startModAgentLoop } from './services/modAgent/modAgentLoop.js';
import { startModInventoryScanLoop } from './services/modInventoryScan.js';
import { startControlApiAgentPresenceLoop } from './services/controlApiAgentPresence.js';
import { modLocalUploadRouter, modBlobRouter } from './routes/modEdgeRoutes.js';
import {
  isEdgeConfigSyncEnabled,
  isHubCentricEdgeMode,
  isHubWorkerMode,
  shouldEdgeUseDirectConvex,
} from '@projectd/ac-data-shared/services/hubWorkerUrl.js';

const SERVERS_PATH = process.env.SERVERS_PATH;
if (!SERVERS_PATH) {
  console.error(`❌ SERVERS_PATH no está definido en ${resolveEnvFilePath()}`);
  process.exit(1);
}

/** Warn when mod pool and SERVERS_PATH/content are different trees (common on US VPS). */
function warnIfContentPathDivergesFromServers(): void {
  const contentPath = (process.env.CONTENT_PATH || '').trim();
  if (!contentPath) return;
  const serversContent = path.join(SERVERS_PATH, 'content');
  try {
    if (!fs.existsSync(serversContent)) return;
    const realPool = fs.realpathSync(contentPath);
    const realServers = fs.realpathSync(serversContent);
    if (realPool !== realServers) {
      console.warn(
        `[ac-data-edge] CONTENT_PATH (${contentPath}) ≠ SERVERS_PATH/content (${serversContent}). ` +
          'Mod-agent installs into CONTENT_PATH; ensure each instance content/ (or shared content) links to that pool.',
      );
    }
  } catch {
    // missing paths / bad symlinks — leave for runtime errors
  }
}
warnIfContentPathDivergesFromServers();

assertSecurityConfiguration();
assertFleetBootGuards('edge');

installFatalProcessHandlers({ serviceName: 'ac-data-edge' });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = process.env.AC_DATA_BIND_HOST || '0.0.0.0';

const CORS_ORIGIN = process.env.CORS_ORIGIN || `http://localhost:${PORT}`;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  if (origin === CORS_ORIGIN) {
    return true;
  }
  return CORS_ORIGINS.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const apiKeyMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  const validKey = process.env.API_KEY;

  if (!validKey) {
    console.warn(`⚠️ API_KEY no está definida en ${resolveEnvFilePath()}.`);
    return res.status(500).json({ error: 'Server Configuration Error: API_KEY missing' });
  }

  if (providedKey !== validKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  next();
};

app.get('/api/live', getPublicLiveHandler);
app.get('/api/health', getPublicHealthHandler);

app.use('/ac-server', apiKeyMiddleware, acServerRoutes);
// HUD zip downloads (/client/hud/*) are hub-only — see MULTI_REGION_EDGE.md
app.use('/hud', ...hudMiddleware, hudRoutes);
app.use('/admin', adminRoutes);
app.use('/admin', modLocalUploadRouter);
app.use('/api', modBlobRouter);

initHudPushHub();
startHudConvexQueryStatsLogging();

const localManaged = bootstrapManagedServersFromDisk(SERVERS_PATH);
if (localManaged > 0) {
  console.log(`[hud-managed-servers] bootstrapped ${localManaged} server(s) from ${SERVERS_PATH}`);
}

const server = createServer(app);
attachHudWs(server);

server.listen(PORT, BIND_HOST, async () => {
  const workerMode =
    isHubWorkerMode() && !shouldEdgeUseDirectConvex() ? 'hub-forward' : 'convex-direct';
  console.log(
    `[ac-data-edge] hub-centric=${isHubCentricEdgeMode()} ingest=${isBackendIngestForwardConfigured() ? 'backend-forward' : 'convex-direct'} worker=${workerMode} config-sync=${isEdgeConfigSyncEnabled() ? 'edge' : 'hub'}`,
  );
  void startRedisConvexBridge();
  void startRedisConfigApplier();
  startServerPoolMonitor();
  startModAgentLoop();
  startModInventoryScanLoop();
  startControlApiAgentPresenceLoop();
  void publishHudRegistryToHubIfConfigured().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hud-registry-sync] startup failed: ${message}`);
  });
  console.log(`ac-data-edge en http://${BIND_HOST}:${PORT}`);
});
