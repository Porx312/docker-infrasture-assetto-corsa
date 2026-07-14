import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHudServerName } from './hudQueryNormalize.js';

test('normalizeHudServerName strips CM suffix', () => {
  assert.equal(
    normalizeHudServerName(
      'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf ℹ18081',
    ),
    'ProjectD |Akina Downhill | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf',
  );
});
