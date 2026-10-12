import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { buildTargetUrl, proxyAdminRequestToEdge } from './edgeAdminProxy.js';
import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';

test('buildTargetUrl pins origin-form path to edge base', () => {
  const url = buildTargetUrl('http://10.0.0.2:3000', '/admin/content?fleetEdge=eu&x=1');
  assert.equal(url.origin, 'http://10.0.0.2:3000');
  assert.equal(url.pathname, '/admin/content');
  assert.equal(url.searchParams.get('fleetEdge'), null);
  assert.equal(url.searchParams.get('x'), '1');
});

test('buildTargetUrl rejects absolute-form override (AUD2-08)', () => {
  assert.throws(
    () => buildTargetUrl('http://10.0.0.2:3000', 'http://127.0.0.1:9/admin/content?fleetEdge=eu'),
    /absolute|invalid_proxy_target/,
  );
  assert.throws(
    () => buildTargetUrl('http://10.0.0.2:3000', 'https://evil.example/admin/content'),
    /invalid_proxy_target/,
  );
  assert.throws(
    () => buildTargetUrl('http://10.0.0.2:3000', '//evil.example/admin/content'),
    /invalid_proxy_target/,
  );
  assert.throws(
    () => buildTargetUrl('http://10.0.0.2:3000', 'http://169.254.169.254/admin/content'),
    /invalid_proxy_target/,
  );
});

test('buildTargetUrl rejects non-admin paths', () => {
  assert.throws(
    () => buildTargetUrl('http://10.0.0.2:3000', '/worker/ingest-events'),
    /path must start with \/admin/,
  );
});

test('proxyAdminRequestToEdge does not send secret to absolute sink (AUD2-08)', async () => {
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_SECRET = 'LEAKME-fleet-secret-for-proxy-test';

  let edgeHits = 0;
  let sinkHits = 0;
  let sinkSecret = '';

  const edge = http.createServer((req, res) => {
    edgeHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, via: 'edge' }));
  });
  const sink = http.createServer((req, res) => {
    sinkHits += 1;
    sinkSecret = String(req.headers['x-worker-secret'] || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, via: 'sink' }));
  });

  await new Promise<void>((resolve) => edge.listen(0, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
  const edgePort = (edge.address() as { port: number }).port;
  const sinkPort = (sink.address() as { port: number }).port;

  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'EU',
      baseUrl: `http://127.0.0.1:${edgePort}`,
      instanceId: 'vps-eu',
    },
  });
  resetFleetRegistryForTests();

  try {
    const resHappy = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
      },
      setHeader() {},
      send() {},
    };
    await proxyAdminRequestToEdge(
      'eu',
      {
        method: 'GET',
        originalUrl: '/admin/content?fleetEdge=eu',
        headers: {},
      } as never,
      resHappy as never,
    );
    assert.equal(resHappy.statusCode, 200);
    assert.equal(edgeHits, 1);
    assert.equal(sinkHits, 0);

    const resEvil = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
      },
      setHeader() {},
      send() {},
    };
    await proxyAdminRequestToEdge(
      'eu',
      {
        method: 'GET',
        originalUrl: `http://127.0.0.1:${sinkPort}/admin/content?fleetEdge=eu`,
        headers: {},
      } as never,
      resEvil as never,
    );
    assert.equal(resEvil.statusCode, 400);
    assert.equal(sinkHits, 0);
    assert.equal(sinkSecret, '');
    assert.equal(edgeHits, 1);
  } finally {
    if (prevRegistry === undefined) delete process.env.FLEET_EDGE_REGISTRY;
    else process.env.FLEET_EDGE_REGISTRY = prevRegistry;
    resetFleetRegistryForTests();
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
    await new Promise<void>((resolve) => edge.close(() => resolve()));
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  }
});

test('proxyAdminRequestToEdge does not follow redirect to sink with secret', async () => {
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  process.env.FLEET_EDGE_SECRET = 'LEAKME-redirect-test-secret!!!!';

  let sinkHits = 0;
  let sinkSecret = '';

  const sink = http.createServer((req, res) => {
    sinkHits += 1;
    sinkSecret = String(req.headers['x-worker-secret'] || '');
    res.writeHead(200);
    res.end('sink');
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
  const sinkPort = (sink.address() as { port: number }).port;

  const edge = http.createServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${sinkPort}/stolen` });
    res.end();
  });
  await new Promise<void>((resolve) => edge.listen(0, '127.0.0.1', () => resolve()));
  const edgePort = (edge.address() as { port: number }).port;

  const prevRegistry = process.env.FLEET_EDGE_REGISTRY;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: {
      label: 'EU',
      baseUrl: `http://127.0.0.1:${edgePort}`,
      instanceId: 'vps-eu',
    },
  });
  resetFleetRegistryForTests();

  try {
    const res = {
      statusCode: 0,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {},
      setHeader() {},
      send() {},
    };
    await proxyAdminRequestToEdge(
      'eu',
      { method: 'GET', originalUrl: '/admin/content', headers: {} } as never,
      res as never,
    );
    assert.equal(res.statusCode, 302);
    assert.equal(sinkHits, 0);
    assert.equal(sinkSecret, '');
  } finally {
    if (prevRegistry === undefined) delete process.env.FLEET_EDGE_REGISTRY;
    else process.env.FLEET_EDGE_REGISTRY = prevRegistry;
    resetFleetRegistryForTests();
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
    await new Promise<void>((resolve) => edge.close(() => resolve()));
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  }
});
