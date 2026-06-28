import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCarModelId,
  pickCarModelId,
  readCarModelFromEventData,
} from './hudCarModel.js';

test('isCarModelId accepts internal ids and rejects display names', () => {
  assert.equal(isCarModelId('ks_toyota_gt86'), true);
  assert.equal(isCarModelId('ae86'), true);
  assert.equal(isCarModelId('Trueno AE86'), false);
  assert.equal(isCarModelId('Toyota GT86'), false);
});

test('pickCarModelId prefers car_id over display carModel', () => {
  assert.equal(
    pickCarModelId('Trueno AE86', ['ks_toyota_gt86']),
    'ks_toyota_gt86',
  );
  assert.equal(pickCarModelId('ks_toyota_gt86', ['Trueno AE86']), 'ks_toyota_gt86');
});

test('readCarModelFromEventData prefers car_id field', () => {
  assert.equal(
    readCarModelFromEventData({
      carModel: 'Trueno AE86',
      car_id: 'ks_toyota_gt86',
    }),
    'ks_toyota_gt86',
  );
});
