import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHudUpdateMessage } from './hudUpdatesSubscriber.js';

test('parseHudUpdateMessage accepts battle scopeKey', () => {
  const parsed = parseHudUpdateMessage(
    JSON.stringify({
      scopeKey: 'battle:testing:76561199000000001',
      version: '1719061234567',
      ts: 1719061234567,
    }),
  );
  assert.deepEqual(parsed, {
    scopeKey: 'battle:testing:76561199000000001',
    version: '1719061234567',
    ts: 1719061234567,
  });
});

test('parseHudUpdateMessage accepts board and player scope keys', () => {
  const board = parseHudUpdateMessage(
    JSON.stringify({
      scopeKey: 'board:projectd@pk_akina@downhill@global',
      version: '2',
      ts: 2,
    }),
  );
  assert.equal(board?.scopeKey, 'board:projectd@pk_akina@downhill@global');

  const player = parseHudUpdateMessage(
    JSON.stringify({
      scopeKey: 'player:76561199000000001@projectd@pk_akina@downhill@car',
      version: '3',
      ts: 3,
    }),
  );
  assert.equal(player?.scopeKey, 'player:76561199000000001@projectd@pk_akina@downhill@car');
});

test('parseHudUpdateMessage ignores legacy unprefixed scope keys', () => {
  const parsed = parseHudUpdateMessage(
    JSON.stringify({
      scopeKey: 'projectd@track@@global',
      version: '1',
      ts: 1,
    }),
  );
  assert.equal(parsed, null);
});

test('parseHudUpdateMessage ignores invalid JSON', () => {
  assert.equal(parseHudUpdateMessage('not-json'), null);
});
