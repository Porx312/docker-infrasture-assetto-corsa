import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStreamRow } from '../activity/activityService.js';
import { normalizeStreamEntry, matchesCategory } from '../activity/activityNormalize.js';

test('activity pipeline: redis rows normalize to timeline items', () => {
  const ts = Date.now();
  const join = parseStreamRow(`${ts}-0`, {
    event: 'player_join',
    serverName: 'Porx',
    ts: String(ts),
    payload: JSON.stringify({
      event: 'player_join',
      serverName: 'Porx',
      ts,
      data: { name: 'PORX', steamId: '76561199230780195', carModel: 'ks_mazda_rx7_spirit_r' },
    }),
  });
  assert.ok(join);

  const item = normalizeStreamEntry(join!);
  assert.ok(item);
  assert.equal(item!.kind, 'join');
  assert.equal(matchesCategory(item!, 'connections'), true);
  assert.equal(matchesCategory(item!, 'all'), true);
});

test('activity pipeline: server_status excluded from all category', () => {
  const ts = Date.now();
  const status = parseStreamRow(`${ts}-1`, {
    event: 'server_status',
    serverName: 'Porx',
    ts: String(ts),
    payload: JSON.stringify({
      data: { players: [{ steamId: '1' }] },
    }),
  });
  assert.ok(status);
  const item = normalizeStreamEntry(status!);
  assert.equal(item, null);
});
