/**
 * Shared security gate for hub and edge.
 * Edge skips ADMIN_* (admin UI is hub-only; edge uses worker secret for /admin JSON).
 */

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.trim().toLowerCase() === 'true' || raw === '1';
}

function isProductionLike(): boolean {
  const env = (process.env.ASSETTO_ENV || 'dev').trim().toLowerCase();
  return env === 'prod' || env === 'production';
}

const WEAK_ADMIN_PASSWORDS = new Set(['admin123', 'password', 'changeme']);
const WEAK_JWT_SECRETS = new Set([
  'admin-secret-key-change-in-production',
  'change-this-secret-in-production',
  'secret',
]);

export type SecurityStartupRole = 'edge' | 'hub';

export function assertSecurityConfiguration(
  role: SecurityStartupRole = 'hub',
  resolveEnvFilePath: () => string = () => '.env',
): void {
  const envFile = resolveEnvFilePath();
  const allowInsecure = envBool('ALLOW_INSECURE_DEFAULTS', false);
  const strict = isProductionLike() || !allowInsecure;
  const errors: string[] = [];

  const hudApiKey = (process.env.HUD_API_KEY || '').trim();
  if (!hudApiKey) {
    errors.push('HUD_API_KEY is required (HUD routes must not accept unauthenticated requests)');
  }

  if (role === 'hub') {
    const adminUser = (process.env.ADMIN_USER || '').trim();
    const adminPass = (process.env.ADMIN_PASS || '').trim();
    const adminJwt = (process.env.ADMIN_JWT_SECRET || '').trim();

    if (!adminUser || !adminPass || !adminJwt) {
      errors.push('ADMIN_USER, ADMIN_PASS, and ADMIN_JWT_SECRET must all be set');
    } else if (strict) {
      if (adminUser === 'admin' && WEAK_ADMIN_PASSWORDS.has(adminPass)) {
        errors.push('ADMIN_PASS is a known weak default; set a strong password');
      }
      if (adminPass.length < 16) {
        errors.push('ADMIN_PASS must be at least 16 characters in strict mode');
      }
      if (WEAK_JWT_SECRETS.has(adminJwt) || adminJwt.length < 32) {
        errors.push('ADMIN_JWT_SECRET must be at least 32 characters and not a placeholder');
      }
    }
  }

  const fleetSecret = (process.env.FLEET_EDGE_SECRET || '').trim();
  const peerSecret = (process.env.MOD_PEER_SECRET || '').trim();
  const convexSecret = (process.env.CONVEX_WORKER_SECRET || '').trim();

  if (strict) {
    if (!convexSecret) {
      errors.push('CONVEX_WORKER_SECRET is required in strict mode');
    }
    if (!fleetSecret) {
      errors.push(
        'FLEET_EDGE_SECRET is required in strict mode (do not reuse CONVEX_WORKER_SECRET)',
      );
    } else if (fleetSecret === convexSecret) {
      errors.push('FLEET_EDGE_SECRET must differ from CONVEX_WORKER_SECRET');
    }
    if (!peerSecret) {
      errors.push(
        'MOD_PEER_SECRET is required in strict mode (do not reuse fleet/convex secrets)',
      );
    } else if (peerSecret === convexSecret || peerSecret === fleetSecret) {
      errors.push('MOD_PEER_SECRET must differ from FLEET_EDGE_SECRET and CONVEX_WORKER_SECRET');
    }
  } else if (!fleetSecret && !convexSecret) {
    errors.push('FLEET_EDGE_SECRET or CONVEX_WORKER_SECRET is required');
  }

  if (strict && errors.length > 0) {
    console.error(`❌ Security configuration failed (${envFile}):`);
    for (const err of errors) {
      console.error(`   - ${err}`);
    }
    console.error('Set ALLOW_INSECURE_DEFAULTS=true for local dev only, or fix the variables above.');
    process.exit(1);
  }

  if (!strict && errors.length > 0) {
    console.warn(`⚠️ Insecure configuration allowed (ALLOW_INSECURE_DEFAULTS=true): ${envFile}`);
    for (const err of errors) {
      console.warn(`   - ${err}`);
    }
  }
}
