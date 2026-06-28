import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSseEvent } from './hudStreamSse.js';

test('formatSseEvent serializes event and JSON data', () => {
  const formatted = formatSseEvent('battle:update', { ok: true, version: '1', state: 'active' });
  assert.equal(
    formatted,
    'event: battle:update\ndata: {"ok":true,"version":"1","state":"active"}\n\n',
  );
});

test('formatSseEvent handles session:update payload', () => {
  const formatted = formatSseEvent('session:update', { ok: true, version: '1:2', players: [] });
  assert.match(formatted, /^event: session:update\n/);
});

test('formatSseEvent handles battle:clear payload', () => {
  const formatted = formatSseEvent('battle:clear', { ok: false, reason: 'no_battle' });
  assert.match(formatted, /^event: battle:clear\n/);
  assert.match(formatted, /"reason":"no_battle"/);
});
