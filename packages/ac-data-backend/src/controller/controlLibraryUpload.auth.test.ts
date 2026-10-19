/**
 * Control library upload handlers reject missing worker secret.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import {
  controlLibrarySlimUploadPlanHandler,
  controlLibraryZipUploadHandler,
  listModsBySteamHandler,
  unlinkSteamLibraryModHandler,
} from './controlApiController.js';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const out = {
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
  return out as unknown as Response & { statusCode: number; body: unknown };
}

test('control library zip-upload returns 401 without worker secret', async () => {
  const prev = process.env.CONVEX_WORKER_SECRET;
  const prevFleet = process.env.FLEET_EDGE_SECRET;
  delete process.env.CONVEX_WORKER_SECRET;
  delete process.env.FLEET_EDGE_SECRET;
  const res = mockRes();
  await controlLibraryZipUploadHandler({ body: {}, headers: {} } as Request, res);
  assert.equal(res.statusCode, 401);
  if (prev !== undefined) process.env.CONVEX_WORKER_SECRET = prev;
  if (prevFleet !== undefined) process.env.FLEET_EDGE_SECRET = prevFleet;
});

test('control library plan returns 401 without worker secret', async () => {
  const prev = process.env.CONVEX_WORKER_SECRET;
  const prevFleet = process.env.FLEET_EDGE_SECRET;
  delete process.env.CONVEX_WORKER_SECRET;
  delete process.env.FLEET_EDGE_SECRET;
  const res = mockRes();
  await controlLibrarySlimUploadPlanHandler(
    { body: {}, headers: {} } as Request,
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal((res.body as { error?: string }).error, 'unauthorized');
  if (prev !== undefined) process.env.CONVEX_WORKER_SECRET = prev;
  if (prevFleet !== undefined) process.env.FLEET_EDGE_SECRET = prevFleet;
});

test('listModsBySteam returns 401 without worker secret', async () => {
  const prev = process.env.CONVEX_WORKER_SECRET;
  const prevFleet = process.env.FLEET_EDGE_SECRET;
  delete process.env.CONVEX_WORKER_SECRET;
  delete process.env.FLEET_EDGE_SECRET;
  const res = mockRes();
  await listModsBySteamHandler(
    { params: { steamId: '76561199000000001' }, headers: {} } as unknown as Request,
    res,
  );
  assert.equal(res.statusCode, 401);
  if (prev !== undefined) process.env.CONVEX_WORKER_SECRET = prev;
  if (prevFleet !== undefined) process.env.FLEET_EDGE_SECRET = prevFleet;
});

test('unlinkSteamLibraryMod returns 401 without worker secret', async () => {
  const prev = process.env.CONVEX_WORKER_SECRET;
  const prevFleet = process.env.FLEET_EDGE_SECRET;
  delete process.env.CONVEX_WORKER_SECRET;
  delete process.env.FLEET_EDGE_SECRET;
  const res = mockRes();
  await unlinkSteamLibraryModHandler(
    {
      params: { packageId: '00000000-0000-0000-0000-000000000001' },
      body: { steamId: '76561199000000001' },
      query: {},
      headers: {},
    } as unknown as Request,
    res,
  );
  assert.equal(res.statusCode, 401);
  if (prev !== undefined) process.env.CONVEX_WORKER_SECRET = prev;
  if (prevFleet !== undefined) process.env.FLEET_EDGE_SECRET = prevFleet;
});
