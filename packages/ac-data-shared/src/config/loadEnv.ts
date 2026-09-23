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

/** Load repo env file once (idempotent). */
export function loadEnv(): void {
  if (loaded) return;

  const envPath = resolveEnvFilePath();
  if (!fs.existsSync(envPath)) {
    if (process.env.NODE_ENV === 'test' || process.env.SKIP_ASSETTO_ENV_LOAD === '1') {
      loaded = true;
      return;
    }
    throw new Error(
      `Env file not found: ${envPath}. Copy .env.example to .env.local or .env.production, or set ASSETTO_ENV_FILE.`,
    );
  }

  const parsed = dotenv.parse(readEnvFileContents(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
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

loadEnv();
