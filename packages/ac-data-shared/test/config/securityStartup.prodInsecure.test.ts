import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSecurityConfiguration } from '../../src/config/securityStartup.js';

test('production-like + ALLOW_INSECURE_DEFAULTS=true exits fatally', () => {
  const prev = { ...process.env };
  process.env.ASSETTO_ENV = 'production';
  process.env.ALLOW_INSECURE_DEFAULTS = 'true';
  process.env.HUD_API_KEY = 'hud-key';
  process.env.CONVEX_WORKER_SECRET = 'convex-worker-secret-32chars-min!!';
  process.env.FLEET_EDGE_SECRET = 'fleet-edge-secret-distinct-ok!!';
  process.env.MOD_PEER_SECRET = 'mod-peer-secret-distinct-ok!!!';
  process.env.ADMIN_USER = 'ops';
  process.env.ADMIN_PASS = 'strong-admin-pass-16+';
  process.env.ADMIN_JWT_SECRET = 'jwt-secret-at-least-32-characters!!';

  let exitCode: number | undefined;
  const exit = process.exit;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error('exit');
  }) as never;

  try {
    assert.throws(() => assertSecurityConfiguration('hub', () => '.env.test'), /exit/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = exit;
    process.env = prev;
  }
});
