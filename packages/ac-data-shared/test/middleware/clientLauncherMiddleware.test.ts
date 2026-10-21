import assert from 'node:assert/strict';
import test from 'node:test';

import { clientLauncherRequireApiKey } from '../../src/middleware/clientLauncherMiddleware.js';

test('clientLauncherRequireApiKey defaults true in production-like env', () => {
  const prev = { ...process.env };
  delete process.env.CLIENT_LAUNCHER_REQUIRE_API_KEY;
  process.env.ASSETTO_ENV = 'production';
  try {
    assert.equal(clientLauncherRequireApiKey(), true);
  } finally {
    process.env = prev;
  }
});

test('clientLauncherRequireApiKey defaults false in dev', () => {
  const prev = { ...process.env };
  delete process.env.CLIENT_LAUNCHER_REQUIRE_API_KEY;
  process.env.ASSETTO_ENV = 'dev';
  try {
    assert.equal(clientLauncherRequireApiKey(), false);
  } finally {
    process.env = prev;
  }
});

test('clientLauncherRequireApiKey respects explicit false in production', () => {
  const prev = { ...process.env };
  process.env.ASSETTO_ENV = 'production';
  process.env.CLIENT_LAUNCHER_REQUIRE_API_KEY = 'false';
  try {
    assert.equal(clientLauncherRequireApiKey(), false);
  } finally {
    process.env = prev;
  }
});
