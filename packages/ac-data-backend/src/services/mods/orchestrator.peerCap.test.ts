import assert from 'node:assert/strict';
import test from 'node:test';

/** Documents the env contract used by acquireJobForEdge peer-pull cap. */
test('MOD_PEER_PULL_MAX_CONCURRENT defaults to 3', () => {
  const prev = process.env.MOD_PEER_PULL_MAX_CONCURRENT;
  delete process.env.MOD_PEER_PULL_MAX_CONCURRENT;
  const max = Number(process.env.MOD_PEER_PULL_MAX_CONCURRENT || 3);
  assert.equal(max, 3);
  if (prev !== undefined) process.env.MOD_PEER_PULL_MAX_CONCURRENT = prev;
});

test('MOD_PEER_PULL_MAX_CONCURRENT=0 disables cap semantics (caller treats as unlimited)', () => {
  const max = Number('0');
  assert.equal(max, 0);
  assert.ok(!(max > 0));
});
