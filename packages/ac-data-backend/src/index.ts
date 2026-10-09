import '@projectd/ac-data-shared/config/loadEnv.js';
import { assertFleetBootGuards } from '@projectd/ac-data-shared/services/fleet/fleetBootGuards.js';
import { assertSecurityConfiguration } from './config/securityStartup.js';
import { createServer } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import adminRoutes from './routes/adminRoutes.js';
import hudGatewayRoutes from './routes/hudGatewayRoutes.js';
import workerIngestRoutes from './routes/workerIngestRoutes.js';
import workerQueryRoutes from './routes/workerQueryRoutes.js';
import hubWorkerWebhookRoutes from './routes/hubWorkerWebhookRoutes.js';
import clientSyncRoutes from '@projectd/ac-data-shared/routes/clientSyncRoutes.js';
import { clientLauncherMiddleware } from '@projectd/ac-data-shared/middleware/clientLauncherMiddleware.js';
import hudRegistryRoutes from './routes/hudRegistryRoutes.js';
import modAgentRoutes from './routes/modAgentRoutes.js';
import controlApiRoutes from './routes/controlApiRoutes.js';
import { runModMigrationsIfConfigured } from './services/mods/migrate.js';
import { loadFleetRegistryFromDb } from './services/mods/loadFleetRegistryFromDb.js';
import { getPublicHealthHandler } from '@projectd/ac-data-shared/controller/healthController.js';
import { attachHudGatewayWs } from './services/hud/hudGateway.js';
import { loadHudDynamicRegistryFromRedis } from './services/hud/hudDynamicRegistry.js';
import { resolveEnvFilePath } from '@projectd/ac-data-shared/config/loadEnv.js';
import { getPublicBrandingImageHandler } from './controller/brandingImagesController.js';
import { getPublicModPreviewImageHandler } from './controller/modPreviewImagesController.js';
import {
  ensureBrandingImagesDir,
  resolveBrandingImagesPath,
} from './services/brandingImages.js';
import {
  ensureModPreviewImagesDir,
  resolveModPreviewImagesPath,
} from './services/mods/modPreviewImages.js';

assertSecurityConfiguration();
assertFleetBootGuards('hub');

process.on('unhandledRejection', (reason) => {
  console.error('[ac-data-backend] unhandledRejection:', reason);
});

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = process.env.AC_DATA_BIND_HOST || '0.0.0.0';

const HUD_CORS = process.env.HUD_CORS_ORIGIN || '*';

app.use((req, res, next) => {
  if (req.path.startsWith('/hud')) {
    res.setHeader('Access-Control-Allow-Origin', HUD_CORS);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_VIEWS_PATH = process.env.ADMIN_VIEWS_PATH || path.join(acDataRoot, '..', 'views');
const ADMIN_PUBLIC_PATH = process.env.ADMIN_PUBLIC_PATH || path.join(acDataRoot, '..', 'public');

app.get('/api/health', getPublicHealthHandler);
app.get('/branding/images/:filename', (req, res) => {
  void getPublicBrandingImageHandler(req, res);
});
app.get('/mods/images/:filename', (req, res) => {
  void getPublicModPreviewImageHandler(req, res);
});
app.use('/api', modAgentRoutes);
app.use('/v1', controlApiRoutes);
app.use('/client', ...clientLauncherMiddleware, clientSyncRoutes);
app.use('/worker', workerIngestRoutes);
app.use('/worker', workerQueryRoutes);
app.use('/hud', hudGatewayRoutes);
app.use('/hud/registry', hudRegistryRoutes);
app.use('/hud', hubWorkerWebhookRoutes);
app.use('/admin', adminRoutes);

app.use('/admin', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use('/admin', express.static(ADMIN_VIEWS_PATH, { maxAge: 0 }));
app.use('/admin', express.static(ADMIN_PUBLIC_PATH, { maxAge: 0 }));

const server = createServer(app);
attachHudGatewayWs(server);

server.listen(PORT, BIND_HOST, () => {
  void ensureBrandingImagesDir()
    .then((dir) => {
      console.log(`[branding-images] serving ${dir} at /branding/images/:filename`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[branding-images] mkdir failed (${resolveBrandingImagesPath()}): ${message}`);
    });
  void ensureModPreviewImagesDir()
    .then((dir) => {
      console.log(`[mod-previews] serving ${dir} at /mods/images/:filename`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mod-previews] mkdir failed (${resolveModPreviewImagesPath()}): ${message}`);
    });
  void runModMigrationsIfConfigured()
    .then(() => loadFleetRegistryFromDb())
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[mod-db] migration failed:', message);
    });
  void loadHudDynamicRegistryFromRedis();
  console.log(`ac-data-backend en http://${BIND_HOST}:${PORT} (env: ${resolveEnvFilePath()})`);
});
