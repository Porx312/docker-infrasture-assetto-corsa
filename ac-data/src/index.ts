import './config/loadEnv.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import acServerRoutes from './routes/acServerRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import clientSyncRoutes from './routes/clientSyncRoutes.js';
import hudRoutes from './routes/hudRoutes.js';
import { clientLauncherMiddleware } from './middleware/clientLauncherMiddleware.js';
import { hudMiddleware } from './middleware/hudMiddleware.js';
import { initHudPushHub } from './services/hud/battleHudPush.js';
import { startHudConvexQueryStatsLogging } from './services/hud/hudConvexQueryStats.js';
import { startRedisConvexBridge } from './services/redisConvexBridge.js';
import { startRedisConfigApplier } from './services/redisConfigApplier.js';
import { startServerPoolMonitor } from './services/serverPool.js';
import { getPublicHealthHandler } from './controller/healthController.js';
import { resolveEnvFilePath } from './config/loadEnv.js';

const SERVERS_PATH = process.env.SERVERS_PATH;
if (!SERVERS_PATH) {
    console.error(`❌ SERVERS_PATH no está definido en ${resolveEnvFilePath()}`);
    process.exit(1);
}

// Last-resort safety net: primary error handling is in hudConvex + HUD routes.
process.on('unhandledRejection', (reason) => {
  console.error('[ac-data] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[ac-data] uncaughtException:', err);
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

// ------------------------ MIDDLEWARE ------------------------
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ------------------------ RUTAS & MIDDLEWARES ------------------------
// Middleware de validación de API KEY
const apiKeyMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  const validKey = process.env.API_KEY;

  if (!validKey) {
    console.warn(`⚠️ API_KEY no está definida en ${resolveEnvFilePath()}. Todas las peticiones serán bloqueadas.`);
    return res.status(500).json({ error: "Server Configuration Error: API_KEY missing" });
  }

  if (providedKey !== validKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  next();
};

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_VIEWS_PATH = process.env.ADMIN_VIEWS_PATH || path.join(acDataRoot, '..', 'views');
const ADMIN_PUBLIC_PATH = process.env.ADMIN_PUBLIC_PATH || path.join(acDataRoot, '..', 'public');

app.get('/api/health', getPublicHealthHandler);

app.use('/ac-server', apiKeyMiddleware, acServerRoutes);
app.use('/client', ...clientLauncherMiddleware, clientSyncRoutes);
app.use('/hud', ...hudMiddleware, hudRoutes);
app.use('/admin', adminRoutes);

app.use('/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/admin', express.static(ADMIN_VIEWS_PATH, {
  etag: false,
  lastModified: false,
  maxAge: 0,
}));
app.use('/admin', express.static(ADMIN_PUBLIC_PATH, {
  etag: false,
  lastModified: false,
  maxAge: 0,
}));

// ------------------------ START SERVER ------------------------
initHudPushHub();
startHudConvexQueryStatsLogging();

app.listen(PORT, BIND_HOST, async () => {
  void startRedisConvexBridge();
  void startRedisConfigApplier();
  startServerPoolMonitor();
  console.log(`API corriendo en http://${BIND_HOST}:${PORT}`);
});
