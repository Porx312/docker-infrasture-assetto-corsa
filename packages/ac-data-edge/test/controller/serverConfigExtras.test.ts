import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyServerConfiguration } from '../../src/controller/controller.js';

test('applyServerConfiguration writes tyre blankets and timeOfDay presets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-extras-'));
  const prev = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;
  try {
    const cfgDir = path.join(tmp, name, 'cfg');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'server_cfg.ini');
    fs.writeFileSync(
      cfgPath,
      '[SERVER]\nNAME=t\nSUN_ANGLE=64\nTIME_OF_DAY_MULT=1\nTYRE_BLANKETS_ALLOWED=1\n',
      'utf-8',
    );

    const result = applyServerConfiguration(name, {
      tyreBlanketsAllowed: false,
      timeOfDay: 'night',
    });
    assert.equal(result.ok, true);
    const content = fs.readFileSync(cfgPath, 'utf-8');
    assert.match(content, /^TYRE_BLANKETS_ALLOWED=0$/m);
    assert.match(content, /^SUN_ANGLE=-80$/m);
    assert.match(content, /^TIME_OF_DAY_MULT=1$/m);
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('applyServerConfiguration ignores unknown timeOfDay without failing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-tod-'));
  const prev = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;
  try {
    const cfgDir = path.join(tmp, name, 'cfg');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'server_cfg.ini');
    fs.writeFileSync(cfgPath, '[SERVER]\nNAME=t\nSUN_ANGLE=64\n', 'utf-8');

    const result = applyServerConfiguration(name, { timeOfDay: 'dusk' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.modifications.length, 0);
    }
    assert.match(fs.readFileSync(cfgPath, 'utf-8'), /^SUN_ANGLE=64$/m);
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('applyServerConfiguration syncs PRACTICE NAME and night under SERVER', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-practice-'));
  const prev = process.env.SERVERS_PATH;
  const name = 'server-1';
  process.env.SERVERS_PATH = tmp;
  try {
    const cfgDir = path.join(tmp, name, 'cfg');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'server_cfg.ini');
    fs.writeFileSync(
      cfgPath,
      [
        '[SERVER]',
        'NAME=old lobby',
        'HTTP_PORT=8082',
        'SUN_ANGLE=64',
        'TIME_OF_DAY_MULT=1',
        '',
        '[PRACTICE]',
        'NAME=akina practice',
        'TIME=1440',
        'IS_OPEN=1',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(cfgDir, 'cm_wrapper_params.json'),
      JSON.stringify({ port: 18082 }),
      'utf-8',
    );

    const result = applyServerConfiguration(name, {
      displayName: 'Gunsai Night',
      timeOfDay: 'night',
    });
    assert.equal(result.ok, true);
    const content = fs.readFileSync(cfgPath, 'utf-8');

    assert.match(content, /\[SERVER\][\s\S]*?^NAME=Gunsai Night \u213918082$/m);
    assert.match(content, /\[PRACTICE\]\s*\nNAME=Gunsai Night\n/);
    assert.doesNotMatch(content, /NAME=akina practice/);
    assert.match(content, /\[SERVER\][\s\S]*?^SUN_ANGLE=-80$/m);
    assert.match(content, /\[SERVER\][\s\S]*?^TIME_OF_DAY_MULT=1$/m);
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
