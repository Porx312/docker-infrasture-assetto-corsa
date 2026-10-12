import assert from 'node:assert/strict';
import test from 'node:test';

import { isWorkerRequestAuthorized } from '../hud/hudWorkerAuth.js';
import { postToEdgeWorker } from './edgeWorkerForward.js';

test('postToEdgeWorker sends FLEET_EDGE_SECRET when distinct from CONVEX_WORKER_SECRET', async () => {
  const prev = { ...process.env };
  process.env.FLEET_EDGE_SECRET = 'fleet-secret-value-32chars!!!!!!';
  process.env.CONVEX_WORKER_SECRET = 'convex-secret-value-32chars!!!!!';
  process.env.ALLOW_INSECURE_DEFAULTS = 'false';
  process.env.ASSETTO_ENV = 'production';

  const originalFetch = globalThis.fetch;
  let seenSecret = '';
  let bodyHadWorkerSecret = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seenSecret = headers.get('x-worker-secret') || '';
    const raw = typeof init?.body === 'string' ? init.body : '';
    bodyHadWorkerSecret = raw.includes('workerSecret');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await postToEdgeWorker('http://edge.example:3000', '/hud/worker/refresh-user', {
      steamId: '76561199000000001',
    });
    assert.equal(result.ok, true);
    assert.equal(seenSecret, 'fleet-secret-value-32chars!!!!!!');
    assert.equal(bodyHadWorkerSecret, false);

    const authorized = isWorkerRequestAuthorized({
      headers: { 'x-worker-secret': seenSecret },
      body: {},
    } as never);
    assert.equal(authorized, true);
    assert.equal(
      isWorkerRequestAuthorized({
        headers: { 'x-worker-secret': 'convex-secret-value-32chars!!!!!' },
        body: {},
      } as never),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env = prev;
  }
});
