import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

let loaded = false;

/** Resolve env file: ASSETTO_ENV_FILE > ASSETTO_ENV (dev|prod) > .env.local */
export function resolveEnvFilePath(): string {
  const explicit = process.env.ASSETTO_ENV_FILE?.trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(REPO_ROOT, explicit);
  }

  const mode = (process.env.ASSETTO_ENV || 'dev').trim().toLowerCase();
  const fileName =
    mode === 'prod' || mode === 'production' ? '.env.production' : '.env.local';
  return path.join(REPO_ROOT, fileName);
}

/** Load repo env file once (idempotent). */
export function loadEnv(): void {
  if (loaded) return;

  const envPath = resolveEnvFilePath();
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `Env file not found: ${envPath}. Copy .env.example to .env.local or .env.production, or set ASSETTO_ENV_FILE.`,
    );
  }

  const result = dotenv.config({ path: envPath });
  if (result.error) {
    throw result.error;
  }

  loaded = true;
}

loadEnv();
