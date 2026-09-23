import type { Request, Response, NextFunction } from 'express';
import { resolveEnvFilePath } from '../config/loadEnv.js';

export function clientSyncApiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const validKey = process.env.CLIENT_SYNC_API_KEY?.trim();
  if (!validKey) {
    console.warn(`CLIENT_SYNC_API_KEY not set in ${resolveEnvFilePath()}. Client sync API blocked.`);
    res.status(500).json({ error: 'Server Configuration Error: CLIENT_SYNC_API_KEY missing' });
    return;
  }

  const header = req.headers['x-api-key'];
  const query = req.query.api_key;
  const provided =
    (typeof header === 'string' ? header : Array.isArray(header) ? header[0] : undefined) ??
    (typeof query === 'string' ? query : undefined);

  if (provided !== validKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    return;
  }

  next();
}
