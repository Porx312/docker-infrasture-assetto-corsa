import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSessionHudConnectionCountForTests,
  resetSessionHudPushForTests,
  subscribeSessionHudRooms,
} from './sessionHudPush.js';

test('subscribeSessionHudRooms registers and unregisters player room listeners', () => {
  resetSessionHudPushForTests();

  const listener = () => {};

  const unsubscribe = subscribeSessionHudRooms(
    {
      steamId: '76561199000000001',
      serverName: 'ProjectD',
      track: 'pk_akina',
      trackConfig: 'downhill',
      carModel: 'ks_toyota_gt86',
    },
    listener,
  );

  assert.equal(getSessionHudConnectionCountForTests(), 1);

  unsubscribe();
  assert.equal(getSessionHudConnectionCountForTests(), 0);

  resetSessionHudPushForTests();
});
