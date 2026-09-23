import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';

import workerQueryRoutes from './workerQueryRoutes.js';

test('POST /worker/sync-version rejects unauthorized', async () => {
  const app = express();
  app.use(express.json());
  app.use('/worker', workerQueryRoutes);

  await new Promise<void>((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/worker/sync-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'test' }),
      });
      assert.equal(response.status, 401);
      server.close(() => resolve());
    });
  });
});
