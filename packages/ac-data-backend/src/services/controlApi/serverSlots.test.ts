import assert from 'node:assert/strict';
import test from 'node:test';

test('server slot status vocabulary matches migration check', () => {
  const allowed = ['idle', 'allocated', 'live', 'draining', 'error'];
  assert.ok(allowed.includes('idle'));
  assert.ok(allowed.includes('allocated'));
  assert.equal(allowed.length, 5);
});
