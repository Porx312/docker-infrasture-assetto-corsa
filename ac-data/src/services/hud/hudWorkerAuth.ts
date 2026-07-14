import type { Request } from 'express';

function workerSecretFromEnv(): string {
  return (process.env.CONVEX_WORKER_SECRET || '').trim();
}

export function readWorkerSecretFromRequest(req: Request): string {
  const header = req.headers['x-worker-secret'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  const body = req.body as { workerSecret?: unknown } | undefined;
  if (typeof body?.workerSecret === 'string' && body.workerSecret.trim()) {
    return body.workerSecret.trim();
  }
  return '';
}

export function isWorkerRequestAuthorized(req: Request): boolean {
  const expected = workerSecretFromEnv();
  if (!expected) {
    return false;
  }
  return readWorkerSecretFromRequest(req) === expected;
}

export function readSteamIdFromWorkerRequest(req: Request): string {
  const body = req.body as { steamId?: unknown; steam_id?: unknown } | undefined;
  const value = body?.steamId ?? body?.steam_id;
  return typeof value === 'string' ? value.trim() : '';
}
