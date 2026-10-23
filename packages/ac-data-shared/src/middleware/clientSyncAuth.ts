import type { Request, Response, NextFunction } from 'express';
import { resolveEnvFilePath } from '../config/loadEnv.js';
import { isProductionLike } from '../config/env.js';
import { secretsMatch } from '../services/secrets/fleetSecrets.js';
import { allowApiKeyQueryParam } from './hudApiKeyAuth.js';

export function clientSyncApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const validKey = process.env.CLIENT_SYNC_API_KEY?.trim();
  if (!validKey) {
    console.warn(`CLIENT_SYNC_API_KEY not set in ${resolveEnvFilePath()}. Client sync API blocked.`);
    res.status(500).json({ error: 'Server Configuration Error: CLIENT_SYNC_API_KEY missing' });
    return;
  }

  const header = req.headers['x-api-key'];
  const fromHeader =
    (typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined)?.trim() ||
    '';
  const query = req.query.api_key;

  if (isProductionLike() && !fromHeader && typeof query === 'string' && query.trim()) {
    res.status(401).json({
      error: 'Unauthorized: Use x-api-key header (query api_key disabled in production)',
    });
    return;
  }

  const provided =
    fromHeader ||
    (allowApiKeyQueryParam() && typeof query === 'string' ? query.trim() : '') ||
    undefined;

  if (!provided || !secretsMatch(provided, validKey)) {
    res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    return;
  }

  next();
}
