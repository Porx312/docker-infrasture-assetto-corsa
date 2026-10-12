import assert from 'node:assert/strict';
import test from 'node:test';

import { isHudApiKeyValid, requireHudApiKeyFromQuery } from './hudBattleAuth.js';

test('isHudApiKeyValid rejects all requests when HUD_API_KEY is unset', () => {
  const prev = process.env.HUD_API_KEY;
  try {
    delete process.env.HUD_API_KEY;
    assert.equal(isHudApiKeyValid(undefined), false);
    assert.equal(isHudApiKeyValid('any-key'), false);
  } finally {
    if (prev === undefined) delete process.env.HUD_API_KEY;
    else process.env.HUD_API_KEY = prev;
  }
});

test('isHudApiKeyValid accepts matching key when configured', () => {
  const prev = process.env.HUD_API_KEY;
  try {
    process.env.HUD_API_KEY = 'test-hud-key';
    assert.equal(isHudApiKeyValid('test-hud-key'), true);
    assert.equal(isHudApiKeyValid('wrong'), false);
    assert.equal(requireHudApiKeyFromQuery(undefined, 'test-hud-key').ok, true);
    assert.equal(requireHudApiKeyFromQuery('test-hud-key', undefined).ok, true);
  } finally {
    if (prev === undefined) delete process.env.HUD_API_KEY;
    else process.env.HUD_API_KEY = prev;
  }
});
