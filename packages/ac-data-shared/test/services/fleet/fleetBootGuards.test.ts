import assert from 'node:assert/strict';
import test from 'node:test';

import { collectFleetBootGuards } from '../../../src/services/fleet/fleetBootGuards.js';

test('edge hub-centric rejects localhost Redis', () => {
  const prev = { ...process.env };
  process.env.BACKEND_INGEST_URL = 'https://hub.example.com';
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.FLEET_EDGE_SECRET = 'fleet-secret';
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  const { errors } = collectFleetBootGuards('edge');
  assert.ok(errors.some((e) => e.includes('localhost')));
  process.env = prev;
});

test('edge hub-centric ok with shared Redis + FLEET_EDGE_SECRET', () => {
  const prev = { ...process.env };
  process.env.BACKEND_INGEST_URL = 'https://hub.example.com';
  process.env.REDIS_HOST = '185.252.232.186';
  process.env.FLEET_EDGE_SECRET = 'fleet-secret';
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  const { errors } = collectFleetBootGuards('edge');
  assert.equal(errors.length, 0);
  process.env = prev;
});

test('hub warns when FLEET_EDGE_REGISTRY empty', () => {
  const prev = { ...process.env };
  process.env.REDIS_HOST = '185.252.232.186';
  process.env.FLEET_EDGE_SECRET = 'fleet-secret';
  delete process.env.FLEET_EDGE_REGISTRY;
  const { warnings, errors } = collectFleetBootGuards('hub');
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.includes('FLEET_EDGE_REGISTRY')));
  process.env = prev;
});

test('edge hub-centric rejects CONVEX-only secret in production', () => {
  const prev = { ...process.env };
  process.env.BACKEND_INGEST_URL = 'https://hub.example.com';
  process.env.REDIS_HOST = '185.252.232.186';
  process.env.CONVEX_WORKER_SECRET = 'convex-only-secret';
  delete process.env.FLEET_EDGE_SECRET;
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  process.env.ASSETTO_ENV = 'production';
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  const { errors } = collectFleetBootGuards('edge');
  assert.ok(errors.some((e) => e.includes('FLEET_EDGE_SECRET')));
  process.env = prev;
});

test('edge hub-centric allows CONVEX fallback with insecure defaults in dev', () => {
  const prev = { ...process.env };
  process.env.BACKEND_INGEST_URL = 'https://hub.example.com';
  process.env.REDIS_HOST = '185.252.232.186';
  process.env.CONVEX_WORKER_SECRET = 'convex-fallback-secret';
  delete process.env.FLEET_EDGE_SECRET;
  process.env.ALLOW_INSECURE_DEFAULTS = 'true';
  process.env.ASSETTO_ENV = 'dev';
  delete process.env.CONVEX_DIRECT_ON_EDGE;
  const { errors } = collectFleetBootGuards('edge');
  assert.equal(errors.length, 0);
  process.env = prev;
});
