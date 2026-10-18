import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          name?: string;
          workspaces?: unknown;
        };
        if (
          Array.isArray(pkg.workspaces) ||
          pkg.name === 'assetto-infra' ||
          pkg.name === 'projectd-ac-data-backend-hub'
        ) {
          return dir;
        }
      } catch {
        // ignore invalid package.json
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.resolve(startDir, '../../../..');
}

const REPO_ROOT = findRepoRoot(
  path.dirname(fileURLToPath(import.meta.url)),
);

let loaded = false;

/** Read .env as UTF-8; Windows Notepad often saves UTF-16 LE. */
function readEnvFileContents(envPath: string): string {
  const buf = fs.readFileSync(envPath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.subarray(2).swap16().toString('utf16le');
  }
  return buf.toString('utf8');
}

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

/** Skip reading .env.local/.env.production even when the file exists (unit tests). */
export function shouldSkipEnvFileLoad(): boolean {
  return (
    process.env.SKIP_ASSETTO_ENV_LOAD === '1' ||
    (process.env.NODE_ENV || '').trim().toLowerCase() === 'test'
  );
}

/** True when deploy platforms inject env (Railway/Nixpacks/Dokploy) or production mode. */
function allowMissingEnvFile(): boolean {
  if (shouldSkipEnvFileLoad()) {
    return true;
  }
  const assettoEnv = (process.env.ASSETTO_ENV || '').trim().toLowerCase();
  if (assettoEnv === 'prod' || assettoEnv === 'production') {
    return true;
  }
  if ((process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return true;
  }
  // Railway / Nixpacks / common PaaS markers — vars come from the dashboard, not a file.
  if (
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.NIXPACKS_METADATA ||
    process.env.NIXPACKS_PATH
  ) {
    return true;
  }
  return false;
}

/** Load repo env file once (idempotent). */
export function loadEnv(): void {
  if (loaded) return;

  // Unit tests / CI isolation: never pull REDIS_HOST etc. from a developer .env.local.
  if (shouldSkipEnvFileLoad()) {
    loaded = true;
    if (process.env.ASSETTO_ENV_DEBUG === '1') {
      console.info('[loadEnv] skipped file load (NODE_ENV=test or SKIP_ASSETTO_ENV_LOAD=1)');
    }
    return;
  }

  const envPath = resolveEnvFilePath();
  if (!fs.existsSync(envPath)) {
    if (allowMissingEnvFile()) {
      loaded = true;
      if (process.env.ASSETTO_ENV_DEBUG === '1') {
        console.info(`[loadEnv] no file at ${envPath}; using process.env only`);
      }
      return;
    }
    throw new Error(
      `Env file not found: ${envPath}. Copy .env.example to .env.local or .env.production, or set ASSETTO_ENV_FILE. On Railway/Dokploy set vars in the dashboard (no file needed).`,
    );
  }

  const parsed = dotenv.parse(readEnvFileContents(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    const existing = process.env[key];
    // Empty shell exports (e.g. MOD_S3_PULL_ENABLED=) must not block .env.local —
    // that caused hub installs to fail with "S3 key present but MOD_S3_PULL_ENABLED is not 1".
    if (existing === undefined || existing.trim() === '') {
      process.env[key] = value;
    }
  }

  if (process.env.ASSETTO_ENV_DEBUG === '1') {
    const keys = Object.keys(parsed);
    console.info(
      `[loadEnv] ${envPath} → ${keys.length} keys (${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''})`,
    );
  }

  loaded = true;
}

/** Test hook: allow calling loadEnv() again after changing SKIP/NODE_ENV. */
export function resetLoadEnvForTests(): void {
  loaded = false;
}

loadEnv();
