import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { resetFleetRegistryForTests } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import type { Request } from 'express';

afterEach(() => {
  resetFleetRegistryForTests();
  delete process.env.FLEET_EDGE_REGISTRY;
  delete process.env.CONVEX_WORKER_SECRET;
});

test('fetchMergedActivityFeed tags items with fleetLabel', async () => {
  process.env.CONVEX_WORKER_SECRET = 'secret';
  process.env.FLEET_EDGE_REGISTRY = JSON.stringify({
    eu: { label: 'EU', baseUrl: 'http://127.0.0.1:1' },
    na: { label: 'NA', baseUrl: 'http://127.0.0.1:2' },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    const ts = url.includes('127.0.0.1:1') ? 100 : 200;
    const label = url.includes('127.0.0.1:1') ? 'EU' : 'NA';
    return new Response(
      JSON.stringify({
        ok: true,
        items: [
          {
            id: `${label}-1`,
            ts,
            category: 'connections',
            kind: 'join',
            title: 'Player joined',
            detail: '',
            serverName: 'Test',
            searchText: 'test',
          },
        ],
        nextCursor: null,
        hasMore: false,
        summary: {
          day: '2026-01-01',
          since: 0,
          until: 1,
          joins: 1,
          playerCount: 1,
          players: [],
          laps: 0,
          pbs: 0,
          battles: 0,
          errors: 0,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const { fetchMergedActivityFeed } = await import('./activityFleetMerge.js');
    const req = { originalUrl: '/admin/activity/feed?day=2026-01-01', query: {} } as Request;
    const merged = await fetchMergedActivityFeed(req);
    assert.equal(merged.items.length, 2);
    assert.equal(merged.items[0]!.ts, 200);
    assert.equal(merged.items[0]!.fleetLabel, 'NA');
    assert.equal(merged.items[1]!.fleetLabel, 'EU');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
