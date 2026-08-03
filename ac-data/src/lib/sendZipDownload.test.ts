import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import express from 'express';

import {
  sendZipDownloadFile,
  setZipDownloadNoCacheHeaders,
} from './sendZipDownload.js';

function createMinimalZip(): Buffer {
  // Local file header + central directory for empty zip (22 bytes minimum valid zip)
  return Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function requestZip(
  port: number,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/download',
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('sendZipDownloadFile returns 200 with body even when If-None-Match is sent', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-download-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const zipPath = path.join(tmpDir, 'ProjectD-HUD-test.zip');
  fs.writeFileSync(zipPath, createMinimalZip());

  const app = express();
  app.get('/download', async (_req, res) => {
    setZipDownloadNoCacheHeaders(res, 'ProjectD-HUD-test.zip');
    await sendZipDownloadFile(res, zipPath);
  });

  const server = app.listen(0);
  after(() => {
    server.close();
  });

  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;

  const first = await requestZip(port);
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.length > 0);
  assert.match(String(first.headers['cache-control'] ?? ''), /no-store/);
  assert.ok(!first.headers.etag, 'etag header should not be set');

  const second = await requestZip(port, {
    'If-None-Match': String(first.headers.etag ?? 'W/"fake-etag-from-launcher"'),
  });
  assert.equal(second.statusCode, 200, 'must not return 304 when client sends If-None-Match');
  assert.ok(second.body.length > 0);
  assert.deepEqual(second.body, first.body);
});
