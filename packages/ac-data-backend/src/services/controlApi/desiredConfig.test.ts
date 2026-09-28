import assert from 'node:assert/strict';
import test from 'node:test';

import { validateConfigAgainstMods } from './desiredConfig.js';

test('validateConfigAgainstMods reports missing track and cars', () => {
  const errors = validateConfigAgainstMods(
    [
      {
        track: 'ks_nordschleife',
        entries: [{ model: 'ks_toyota_gt86' }, { model: 'missing_car' }],
        isActive: true,
      },
    ],
    {
      carModels: new Set(['ks_toyota_gt86']),
      trackSlugs: new Set(['ks_vallelunga']),
    },
  );
  assert.deepEqual(errors.sort(), [
    'car_not_installed:missing_car',
    'track_not_installed:ks_nordschleife',
  ]);
});

test('validateConfigAgainstMods skips inactive servers', () => {
  const errors = validateConfigAgainstMods(
    [{ track: 'missing', entries: [{ model: 'x' }], isActive: false }],
    { carModels: new Set(), trackSlugs: new Set() },
  );
  assert.deepEqual(errors, []);
});
