import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

import {
  hubHudApiKeyMiddleware,
  hudGatewayRequireApiKey,
} from '../../src/middleware/hudApiKeyAuth.js';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

test('hudGatewayRequireApiKey defaults true in production-like', () => {
  const prevEnv = process.env.ASSETTO_ENV;
  const prevReq = process.env.HUD_GATEWAY_REQUIRE_API_KEY;
  delete process.env.HUD_GATEWAY_REQUIRE_API_KEY;
  process.env.ASSETTO_ENV = 'production';
  try {
    assert.equal(hudGatewayRequireApiKey(), true);
  } finally {
    if (prevEnv !== undefined) process.env.ASSETTO_ENV = prevEnv;
    else delete process.env.ASSETTO_ENV;
    if (prevReq !== undefined) process.env.HUD_GATEWAY_REQUIRE_API_KEY = prevReq;
    else delete process.env.HUD_GATEWAY_REQUIRE_API_KEY;
  }
});

test('hubHudApiKeyMiddleware rejects missing key when required', () => {
  const prev = { ...process.env };
  process.env.ASSETTO_ENV = 'production';
  process.env.HUD_GATEWAY_REQUIRE_API_KEY = 'true';
  process.env.HUD_API_KEY = 'hud-secret-key';
  try {
    const res = mockRes();
    let nextCalled = false;
    hubHudApiKeyMiddleware(
      { headers: {}, query: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  } finally {
    process.env = prev;
  }
});

test('hubHudApiKeyMiddleware accepts valid x-api-key when required', () => {
  const prev = { ...process.env };
  process.env.ASSETTO_ENV = 'production';
  process.env.HUD_GATEWAY_REQUIRE_API_KEY = 'true';
  process.env.HUD_API_KEY = 'hud-secret-key';
  try {
    const res = mockRes();
    let nextCalled = false;
    hubHudApiKeyMiddleware(
      { headers: { 'x-api-key': 'hud-secret-key' }, query: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(nextCalled, true);
  } finally {
    process.env = prev;
  }
});
