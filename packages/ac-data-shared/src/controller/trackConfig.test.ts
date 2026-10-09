import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTrackConfigForIni } from './trackConfig.js';

test('normalizeTrackConfigForIni maps default and empty to empty string', () => {
    assert.equal(normalizeTrackConfigForIni('default'), '');
    assert.equal(normalizeTrackConfigForIni('Default'), '');
    assert.equal(normalizeTrackConfigForIni(''), '');
    assert.equal(normalizeTrackConfigForIni('  '), '');
});

test('normalizeTrackConfigForIni trims and preserves layout ids', () => {
    assert.equal(normalizeTrackConfigForIni('  downhill  '), 'downhill');
    assert.equal(normalizeTrackConfigForIni('akina_downhill'), 'akina_downhill');
});

test('normalizeTrackConfigForIni leaves undefined unchanged', () => {
    assert.equal(normalizeTrackConfigForIni(undefined), undefined);
});
