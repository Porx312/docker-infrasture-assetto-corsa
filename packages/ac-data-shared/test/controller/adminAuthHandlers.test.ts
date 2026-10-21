import assert from 'node:assert/strict';
import test from 'node:test';

import { adminLogin } from '../../src/controller/adminAuthHandlers.js';

test('adminLogin sets cookie and omits token from JSON body', async () => {
  const prev = { ...process.env };
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASS = 'super-secret-pass';
  process.env.ADMIN_JWT_SECRET = 'jwt-secret-at-least-32-characters!!';

  let status = 0;
  let jsonBody: Record<string, unknown> | null = null;
  let cookieName = '';
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    cookie(name: string) {
      cookieName = name;
      return this;
    },
    json(body: Record<string, unknown>) {
      jsonBody = body;
      return this;
    },
  };

  try {
    await adminLogin(
      { body: { username: 'admin', password: 'super-secret-pass' } } as never,
      res as never,
    );
    assert.equal(status, 0);
    assert.equal(cookieName, 'admin_token');
    assert.ok(jsonBody);
    assert.equal(jsonBody!.ok, true);
    assert.equal('token' in jsonBody!, false);
  } finally {
    process.env = prev;
  }
});
