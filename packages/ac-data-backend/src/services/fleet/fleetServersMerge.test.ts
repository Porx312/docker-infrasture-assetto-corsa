import assert from 'node:assert/strict';
import test from 'node:test';
import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';

test('fetchMergedFleetServers aggregates branding servers from edges', async () => {
  const prevFleet = process.env.FLEET_EDGE_REGISTRY;
  const prevSecret = process.env.FLEET_EDGE_SECRET;
  const prevConvex = process.env.CONVEX_WORKER_SECRET;
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: { label: 'EU', baseUrl: 'http://127.0.0.1:3991', instanceId: 'vps-eu' },
    na: { label: 'NA', baseUrl: 'http://127.0.0.1:3992', instanceId: 'vps-na' },
  });
  // Dedicated fleet secret — CONVEX_WORKER_SECRET fallback needs ALLOW_INSECURE_DEFAULTS.
  process.env.FLEET_EDGE_SECRET = 'test-secret';
  resetFleetRegistryForTests();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('3991')) {
      return new Response(
        JSON.stringify({
          ok: true,
          servers: [{ name: 'server-1', displayName: 'EU Lobby', wrapperPort: 9600 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('3992')) {
      return new Response(
        JSON.stringify({
          ok: true,
          servers: [{ name: 'server-2', displayName: 'NA Lobby', wrapperPort: 9700 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const { fetchMergedFleetServers } = await import('./fleetServersMerge.js');
    const result = await fetchMergedFleetServers();
    assert.equal(result.servers.length, 2);
    assert.equal(result.servers[0]?.fleetLabel, 'EU');
    assert.equal(result.servers[1]?.fleetLabel, 'NA');
  } finally {
    globalThis.fetch = originalFetch;
    if (prevFleet === undefined) delete process.env.FLEET_EDGE_REGISTRY;
    else process.env.FLEET_EDGE_REGISTRY = prevFleet;
    if (prevSecret === undefined) delete process.env.FLEET_EDGE_SECRET;
    else process.env.FLEET_EDGE_SECRET = prevSecret;
    if (prevConvex === undefined) delete process.env.CONVEX_WORKER_SECRET;
    else process.env.CONVEX_WORKER_SECRET = prevConvex;
    resetFleetRegistryForTests();
  }
});
