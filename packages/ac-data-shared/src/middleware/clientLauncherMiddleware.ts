import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { isProductionLike } from '../config/env.js';
import { clientSyncApiKeyMiddleware } from './clientSyncAuth.js';

const LAUNCHER_RATE_LIMIT_MAX = Number(process.env.CLIENT_LAUNCHER_RATE_LIMIT_MAX || 60);
const LAUNCHER_DOWNLOAD_RATE_LIMIT_MAX = Number(process.env.CLIENT_LAUNCHER_DOWNLOAD_RATE_LIMIT_MAX || 10);
const LAUNCHER_CORS_ORIGIN = process.env.CLIENT_LAUNCHER_CORS_ORIGIN || '*';

/**
 * When unset: required in production-like ASSETTO_ENV, optional in dev.
 * Set CLIENT_LAUNCHER_REQUIRE_API_KEY=true|false to override.
 */
export function clientLauncherRequireApiKey(): boolean {
  const raw = process.env.CLIENT_LAUNCHER_REQUIRE_API_KEY;
  if (raw !== undefined && raw.trim() !== '') {
    return raw.trim().toLowerCase() === 'true' || raw === '1';
  }
  return isProductionLike();
}

/** @deprecated Prefer clientLauncherRequireApiKey() — evaluated at import time. */
export const CLIENT_LAUNCHER_REQUIRE_API_KEY = clientLauncherRequireApiKey();

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
  if (!clientLauncherRequireApiKey()) {
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
