/**
 * HUD API key auth for hub gateway (and reusable by edge).
 * Prefer header x-api-key; query api_key rejected in production-like.
 */

import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { envBool, isProductionLike } from '../config/env.js';
import { secretsMatch } from '../services/secrets/fleetSecrets.js';

export function hudGatewayRequireApiKey(): boolean {
  const raw = process.env.HUD_GATEWAY_REQUIRE_API_KEY;
  if (raw !== undefined && raw.trim() !== '') {
    return raw.trim().toLowerCase() === 'true' || raw === '1';
  }
  return isProductionLike();
}

export function allowApiKeyQueryParam(): boolean {
  if (isProductionLike()) return false;
  return envBool('ALLOW_API_KEY_QUERY', true);
}

/** Extract API key from Express req or raw upgrade request. */
export function readApiKeyFromHeaders(
  headers: IncomingMessage['headers'] | Request['headers'],
  queryApiKey?: unknown,
): string {
  const header = headers['x-api-key'];
  const fromHeader =
    typeof header === 'string' ? header.trim() : Array.isArray(header) ? String(header[0] || '').trim() : '';
  if (fromHeader) return fromHeader;
  if (!allowApiKeyQueryParam()) return '';
  if (typeof queryApiKey === 'string' && queryApiKey.trim()) return queryApiKey.trim();
  return '';
}

export function isHudApiKeyAuthorized(
  headers: IncomingMessage['headers'] | Request['headers'],
  queryApiKey?: unknown,
): boolean {
  const expected = (process.env.HUD_API_KEY || '').trim();
  if (!expected) return false;
  const provided = readApiKeyFromHeaders(headers, queryApiKey);
  if (!provided) return false;
  return secretsMatch(provided, expected);
}

/**
 * When gateway require is on: demand valid HUD_API_KEY.
 * When off (dev): pass through (edge still enforces on snapshot).
 */
export function hubHudApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!hudGatewayRequireApiKey()) {
    next();
    return;
  }
  const queryKey = req.query.api_key;
  if (
    isProductionLike() &&
    typeof queryKey === 'string' &&
    queryKey.trim() &&
    !(typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].trim())
  ) {
    res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: 'Use x-api-key header (query api_key disabled in production)',
    });
    return;
  }
  if (!isHudApiKeyAuthorized(req.headers, queryKey)) {
    res.status(401).json({ ok: false, error: 'unauthorized', message: 'Invalid or missing HUD API key' });
    return;
  }
  next();
}

export const hubHudBootstrapRateLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.HUD_BOOTSTRAP_RATE_LIMIT_MAX || 60),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' },
});
