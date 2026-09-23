import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('applyServerConfiguration writes CONFIG_TRACK= for default', async (t) => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-data-track-config-'));
    t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    const serverName = 'test-server';
    const cfgDir = path.join(tmpRoot, serverName, 'cfg');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'server_cfg.ini');
    fs.writeFileSync(cfgPath, '[SERVER]\nCONFIG_TRACK=default\nTRACK=ks_nords\n', 'utf-8');

    process.env.SERVERS_PATH = tmpRoot;
    const controllerUrl = new URL('./controller.js', import.meta.url);
    const { applyServerConfiguration } = await import(controllerUrl.href);

    const result = applyServerConfiguration(serverName, { configTrack: 'default' });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const content = fs.readFileSync(cfgPath, 'utf-8');
    assert.match(content, /^CONFIG_TRACK=$/m);
    assert.doesNotMatch(content, /CONFIG_TRACK=default/);
});
