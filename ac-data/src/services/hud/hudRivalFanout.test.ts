import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldFanoutToPlayer,
  type LapBoardContext,
} from './hudRivalFanout.js';
import type { PlayerPresenceRecord } from './hudTypes.js';

const board: LapBoardContext = {
  serverName: 'Akina TA',
  track: 'pk_akina',
  trackConfig: 'akina_downhill',
  carModel: 'ks_mazda_gt86',
};

const presence: PlayerPresenceRecord = {
  serverName: 'Akina TA',
  track: 'pk_akina',
  trackConfig: 'akina_downhill',
  carModel: 'ks_mazda_gt86',
  updatedAt: Date.now(),
};

test('shouldFanoutToPlayer accepts observer on same board with SSE', () => {
  const authors = new Set(['76561199000000001']);
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, presence, true),
    true,
  );
});

test('shouldFanoutToPlayer rejects lap author', () => {
  const authors = new Set(['76561199588591028']);
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, presence, true),
    false,
  );
});

test('shouldFanoutToPlayer rejects when SSE not connected', () => {
  const authors = new Set(['76561199000000001']);
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, presence, false),
    false,
  );
});

test('shouldFanoutToPlayer rejects different track', () => {
  const authors = new Set(['76561199000000001']);
  const wrongTrack = { ...presence, track: 'spa' };
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, wrongTrack, true),
    false,
  );
});

test('shouldFanoutToPlayer rejects different car on car-scoped board', () => {
  const authors = new Set(['76561199000000001']);
  const wrongCar = { ...presence, carModel: 'ks_toyota_gt86' };
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, wrongCar, true),
    false,
  );
});

test('shouldFanoutToPlayer allows global board without car filter', () => {
  const authors = new Set(['76561199000000001']);
  const globalBoard: LapBoardContext = { ...board, carModel: '' };
  const anyCar = { ...presence, carModel: 'ks_toyota_gt86' };
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, globalBoard, anyCar, true),
    true,
  );
});

test('shouldFanoutToPlayer rejects missing presence', () => {
  const authors = new Set(['76561199000000001']);
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, null, true),
    false,
  );
});

test('shouldFanoutToPlayer normalizes server name CM suffix', () => {
  const authors = new Set(['76561199000000001']);
  const cmPresence = { ...presence, serverName: 'Akina TA ℹ18083' };
  assert.equal(
    shouldFanoutToPlayer('76561199588591028', authors, board, cmPresence, true),
    true,
  );
});
