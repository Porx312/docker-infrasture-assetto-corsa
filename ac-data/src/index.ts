import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import path from 'path';
import acServerRoutes from './routes/acServerRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { startRedisConvexBridge } from './services/redisConvexBridge.js';
import { startRedisConfigApplier } from './services/redisConfigApplier.js';

dotenv.config();

const SERVERS_PATH = process.env.SERVERS_PATH;
if (!SERVERS_PATH) {
    console.error('❌ SERVERS_PATH no está definido en el archivo .env');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://176.57.150.251:3000';

// ------------------------ MIDDLEWARE ------------------------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log(`[CORS] Origin: ${origin}, Path: ${req.path}`);
  if (origin === CORS_ORIGIN || origin === `http://176.57.150.251:${PORT}`) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    console.log('[CORS] Allowed');
  } else {
    console.log('[CORS] Not allowed');
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
    console.warn("⚠️ API_KEY no está definida en el archivo .env. Todas las peticiones serán bloqueadas.");
    return res.status(500).json({ error: "Server Configuration Error: API_KEY missing" });
  }

  if (providedKey !== validKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  next();
};

const ADMIN_VIEWS_PATH = '/home/jose/assetto-infra/ac-data/views';
const ADMIN_PUBLIC_PATH = '/home/jose/assetto-infra/ac-data/public';

app.use('/ac-server', apiKeyMiddleware, acServerRoutes);
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
app.listen(PORT, async () => {
  void startRedisConvexBridge();
  void startRedisConfigApplier();
  console.log(`API corriendo en http://localhost:${PORT}`);
});
