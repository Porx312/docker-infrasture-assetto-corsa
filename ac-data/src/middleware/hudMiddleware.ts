import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

const HUD_RATE_LIMIT_MAX = Number(process.env.HUD_RATE_LIMIT_MAX || 30);
const HUD_CORS_ORIGIN = process.env.HUD_CORS_ORIGIN || '*';

export const hudRateLimiter = rateLimit({
  windowMs: 60_000,
  max: HUD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export function hudCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (HUD_CORS_ORIGIN === '*' || !origin) {
    res.setHeader('Access-Control-Allow-Origin', HUD_CORS_ORIGIN === '*' ? '*' : HUD_CORS_ORIGIN);
  } else if (origin === HUD_CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
}

export function hudCacheHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'public, max-age=10');
  next();
}

export const hudMiddleware = [hudCorsMiddleware, hudCacheHeaders, hudRateLimiter];
