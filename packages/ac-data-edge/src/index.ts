import './config/loadEnv.js';
import { assertSecurityConfiguration } from './config/securityStartup.js';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import adminRoutes from './routes/adminRoutes.js';
import acServerRoutes from './routes/acServerRoutes.js';
import clientSyncRoutes from './routes/clientSyncRoutes.js';
import hudRoutes from './routes/hudRoutes.js';
import { clientLauncherMiddleware } from './middleware/clientLauncherMiddleware.js';
import { hudMiddleware } from './middleware/hudMiddleware.js';
import { initHudPushHub } from './services/hud/battleHudPush.js';
import { startHudConvexQueryStatsLogging } from './services/hud/hudConvexQueryStats.js';
import { startRedisConvexBridge } from './services/redisConvexBridge.js';
import { startRedisConfigApplier } from './services/redisConfigApplier.js';
import { bootstrapManagedServersFromDisk } from './services/hud/hudManagedServers.js';
import { publishHudRegistryToHubIfConfigured } from './services/hud/edgeHudRegistryPublish.js';
import { startServerPoolMonitor } from './services/serverPool.js';
import { getPublicHealthHandler } from './controller/healthController.js';
import { resolveEnvFilePath } from './config/loadEnv.js';
import { attachHudWs } from './services/hud/hudWs.js';
import { isBackendIngestForwardConfigured } from '@projectd/ac-data-shared/services/edgeIngestForward.js';
import { startModAgentLoop } from './services/modAgent/modAgentLoop.js';
import { startModInventoryScanLoop } from './services/modInventoryScan.js';
import { startControlApiAgentPresenceLoop } from './services/controlApiAgentPresence.js';
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

assertSecurityConfiguration();

process.on('unhandledRejection', (reason) => {
  console.error('[ac-data-edge] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[ac-data-edge] uncaughtException:', err);
});

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

app.get('/api/health', getPublicHealthHandler);

app.use('/ac-server', apiKeyMiddleware, acServerRoutes);
app.use('/client', ...clientLauncherMiddleware, clientSyncRoutes);
app.use('/hud', ...hudMiddleware, hudRoutes);
app.use('/admin', adminRoutes);

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
