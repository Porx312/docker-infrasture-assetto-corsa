import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
import express from 'express';
import { createServer } from 'node:http';

import workerIngestRoutes from './workerIngestRoutes.js';

test('POST /worker/ingest-events rejects unauthorized', async () => {
  const prevSecret = process.env.CONVEX_WORKER_SECRET;
  process.env.CONVEX_WORKER_SECRET = 'test-secret';

  const app = express();
  app.use(express.json());
  app.use('/worker', workerIngestRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const response = await fetch(`http://127.0.0.1:${port}/worker/ingest-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ event: 'server_status', serverName: 'x', data: {} }] }),
  });
  assert.equal(response.status, 401);

  server.close();
  process.env.CONVEX_WORKER_SECRET = prevSecret;
});
