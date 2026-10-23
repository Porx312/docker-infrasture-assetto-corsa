import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTimeOfDay,
  resolveTimeOfDayPreset,
} from '../../src/services/timeOfDayPresets.js';
import { buildConfigSignature } from '../../src/services/configApplierLogic.js';

test('normalizeTimeOfDay accepts day night dynamic', () => {
  assert.equal(normalizeTimeOfDay('Day'), 'day');
  assert.equal(normalizeTimeOfDay('NIGHT'), 'night');
  assert.equal(normalizeTimeOfDay('dynamic'), 'dynamic');
  assert.equal(normalizeTimeOfDay('dusk'), undefined);
});

test('resolveTimeOfDayPreset maps sun angle and mult', () => {
  assert.deepEqual(resolveTimeOfDayPreset('day'), { sunAngle: 16, timeOfDayMult: 1 });
  assert.deepEqual(resolveTimeOfDayPreset('night'), { sunAngle: -80, timeOfDayMult: 1 });
  assert.deepEqual(resolveTimeOfDayPreset('dynamic'), { sunAngle: 16, timeOfDayMult: 5 });
});

test('buildConfigSignature changes with timeOfDay and tyreBlankets', () => {
  const base = {
    serverName: 'server-1',
    track: 'akina',
    isActive: true,
  };
  const a = buildConfigSignature(base);
  const c = buildConfigSignature({ ...base, timeOfDay: 'night' });
  const d = buildConfigSignature({ ...base, tyreBlanketsAllowed: false });
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});
