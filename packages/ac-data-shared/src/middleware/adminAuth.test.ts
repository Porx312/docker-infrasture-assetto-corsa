import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

import {
  adminAuth,
  generateToken,
  getAdminCredentials,
  verifyToken,
} from './adminAuth.js';

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

test('adminAuth rejects missing token', () => {
  const res = mockRes();
  let nextCalled = false;
  adminAuth(
    { cookies: {}, headers: {} } as Request,
    res,
    (() => {
      nextCalled = true;
    }) as NextFunction,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('adminAuth accepts valid JWT cookie', () => {
  const prev = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = 'unit-test-admin-jwt-secret-32chars!!';
  try {
    const token = generateToken('admin');
    const res = mockRes();
    let nextCalled = false;
    const req = { cookies: { admin_token: token }, headers: {} } as Request;
    adminAuth(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal((req as { adminUser?: string }).adminUser, 'admin');
  } finally {
    if (prev === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = prev;
  }
});

test('adminAuth accepts Bearer JWT', () => {
  const prev = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = 'unit-test-admin-jwt-secret-32chars!!';
  try {
    const token = generateToken('ops');
    const res = mockRes();
    let nextCalled = false;
    adminAuth(
      { cookies: {}, headers: { authorization: `Bearer ${token}` } } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(nextCalled, true);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = prev;
  }
});

test('adminAuth rejects invalid JWT', () => {
  const prev = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = 'unit-test-admin-jwt-secret-32chars!!';
  try {
    const res = mockRes();
    let nextCalled = false;
    adminAuth(
      { cookies: { admin_token: 'not.a.jwt' }, headers: {} } as Request,
      res,
      (() => {
        nextCalled = true;
      }) as NextFunction,
    );
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = prev;
  }
});

test('verifyToken returns null when ADMIN_JWT_SECRET empty', () => {
  const prev = process.env.ADMIN_JWT_SECRET;
  delete process.env.ADMIN_JWT_SECRET;
  try {
    assert.equal(verifyToken('anything'), null);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = prev;
  }
});

test('getAdminCredentials returns null when empty', () => {
  const prevUser = process.env.ADMIN_USER;
  const prevPass = process.env.ADMIN_PASS;
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASS;
  try {
    assert.equal(getAdminCredentials(), null);
  } finally {
    if (prevUser === undefined) delete process.env.ADMIN_USER;
    else process.env.ADMIN_USER = prevUser;
    if (prevPass === undefined) delete process.env.ADMIN_PASS;
    else process.env.ADMIN_PASS = prevPass;
  }
});
