import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldFetchHudSession } from './hudSessionFetchPolicy.js';

test('shouldFetchHudSession allows cosmetics only', () => {
  assert.equal(shouldFetchHudSession('cosmetics'), true);
  assert.equal(shouldFetchHudSession('worker_cosmetics'), true);
  assert.equal(shouldFetchHudSession('battle_elo'), false);
  assert.equal(shouldFetchHudSession('lap_pb'), false);
  assert.equal(shouldFetchHudSession(undefined), false);
  assert.equal(shouldFetchHudSession(''), false);
});
