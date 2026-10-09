import assert from 'node:assert/strict';
import test from 'node:test';

import { entriesMapFromRecord } from './hudDynamicRegistry.js';

test('entriesMapFromRecord drops stale entries', () => {
  const now = 1_000_000;
  const map = entriesMapFromRecord(
    {
      fresh: {
        baseUrl: 'http://10.0.0.2:3000',
        publicBaseUrl: 'https://eu.example.com',
        instanceId: 'vps-eu',
        source: 'dynamic',
        updatedAt: now - 1_000,
      },
      stale: {
        baseUrl: 'http://10.0.0.3:3000',
        instanceId: 'vps-old',
        source: 'dynamic',
        updatedAt: now - 900_000,
      },
      bad: {
        baseUrl: '',
        source: 'dynamic',
        updatedAt: now,
      } as never,
    },
    now,
    600_000,
  );
  assert.equal(map.size, 1);
  assert.equal(map.get('fresh')?.baseUrl, 'http://10.0.0.2:3000');
  assert.equal(map.has('stale'), false);
});

test('entriesMapFromRecord keeps entries within stale window', () => {
  const now = Date.now();
  const map = entriesMapFromRecord(
    {
      eu: {
        baseUrl: 'http://13.140.160.131:3000',
        instanceId: 'vps-eu-2',
        source: 'dynamic',
        updatedAt: now - 60_000,
      },
    },
    now,
    600_000,
  );
  assert.equal(map.size, 1);
});
