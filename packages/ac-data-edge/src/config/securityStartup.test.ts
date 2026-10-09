import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSecurityConfiguration } from '@projectd/ac-data-shared/config/securityStartup.js';

function setDistinctSecrets(): void {
  process.env.CONVEX_WORKER_SECRET = 'convex-worker-secret-32chars-min!!';
  process.env.FLEET_EDGE_SECRET = 'fleet-edge-secret-distinct-ok!!';
  process.env.MOD_PEER_SECRET = 'mod-peer-secret-distinct-ok!!!';
}

test('edge without EDGE_ADMIN_PUBLIC skips ADMIN_* but still requires HUD_API_KEY in strict mode', () => {
  const prev = { ...process.env };
  process.env.HUD_API_KEY = '';
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  process.env.ASSETTO_ENV = 'dev';
  setDistinctSecrets();
  delete process.env.EDGE_ADMIN_PUBLIC;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASS;
  delete process.env.ADMIN_JWT_SECRET;

  let exitCode: number | undefined;
  const exit = process.exit;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error('exit');
  }) as never;

  try {
    assert.throws(() => assertSecurityConfiguration('edge', () => '.env.test'), /exit/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = exit;
    process.env = prev;
  }
});

test('edge hub-proxy mode accepts missing ADMIN_* when HUD_API_KEY and distinct secrets set', () => {
  const prev = { ...process.env };
  process.env.HUD_API_KEY = 'hud-key';
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  process.env.ASSETTO_ENV = 'dev';
  setDistinctSecrets();
  delete process.env.EDGE_ADMIN_PUBLIC;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASS;
  delete process.env.ADMIN_JWT_SECRET;

  let exited = false;
  const exit = process.exit;
  process.exit = ((() => {
    exited = true;
  }) as never);

  try {
    assertSecurityConfiguration('edge', () => '.env.test');
    assert.equal(exited, false);
  } finally {
    process.exit = exit;
    process.env = prev;
  }
});
