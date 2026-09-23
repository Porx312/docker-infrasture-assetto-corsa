import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConfigSignature } from '../configApplierLogic.js';

test('buildConfigSignature changes when track or entries change', () => {
  const base = {
    serverName: 'server-1',
    displayName: 'Test',
    track: 'pk_akina',
    isActive: true,
    entries: [{ model: 'ks_toyota_gt86', count: 1 }],
  };

  const sig1 = buildConfigSignature(base);
  const sig2 = buildConfigSignature({ ...base, track: 'pk_nagao' });
  const sig3 = buildConfigSignature({
    ...base,
    entries: [{ model: 'ks_mazda_rx7_spirit_r', count: 1 }],
  });

  assert.notEqual(sig1, sig2);
  assert.notEqual(sig1, sig3);
  assert.equal(buildConfigSignature(base), sig1);
});

test('buildConfigSignature normalizes default trackConfig to empty', () => {
  const row = {
    serverName: 'server',
    trackConfig: 'default',
    isActive: true,
  };
  const sigDefault = buildConfigSignature(row);
  const sigEmpty = buildConfigSignature({ ...row, trackConfig: '' });
  assert.equal(sigDefault, sigEmpty);
});
