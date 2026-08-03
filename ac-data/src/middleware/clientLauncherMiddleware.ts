import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { clientSyncApiKeyMiddleware } from './clientSyncAuth.js';

const LAUNCHER_RATE_LIMIT_MAX = Number(process.env.CLIENT_LAUNCHER_RATE_LIMIT_MAX || 60);
const LAUNCHER_DOWNLOAD_RATE_LIMIT_MAX = Number(process.env.CLIENT_LAUNCHER_DOWNLOAD_RATE_LIMIT_MAX || 10);
const LAUNCHER_CORS_ORIGIN = process.env.CLIENT_LAUNCHER_CORS_ORIGIN || '*';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.trim().toLowerCase() === 'true' || raw === '1';
}

export const CLIENT_LAUNCHER_REQUIRE_API_KEY = envBool('CLIENT_LAUNCHER_REQUIRE_API_KEY', false);

function isDownloadPath(req: Request): boolean {
  return req.path.includes('/download');
}

export const clientLauncherRateLimiter = rateLimit({
  windowMs: 60_000,
  max: (req) => (isDownloadPath(req) ? LAUNCHER_DOWNLOAD_RATE_LIMIT_MAX : LAUNCHER_RATE_LIMIT_MAX),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export function clientLauncherCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (LAUNCHER_CORS_ORIGIN === '*' || !origin) {
    res.setHeader('Access-Control-Allow-Origin', LAUNCHER_CORS_ORIGIN === '*' ? '*' : LAUNCHER_CORS_ORIGIN);
  } else if (origin === LAUNCHER_CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
}

export function clientLauncherCacheHeaders(req: Request, res: Response, next: NextFunction): void {
  if (!isDownloadPath(req)) {
    res.setHeader('Cache-Control', 'public, max-age=30');
  }
  next();
}

function optionalLauncherAuth(req: Request, res: Response, next: NextFunction): void {
  if (!CLIENT_LAUNCHER_REQUIRE_API_KEY) {
    next();
    return;
  }
  clientSyncApiKeyMiddleware(req, res, next);
}

export const clientLauncherMiddleware = [
  clientLauncherCorsMiddleware,
  clientLauncherCacheHeaders,
  optionalLauncherAuth,
  clientLauncherRateLimiter,
];
