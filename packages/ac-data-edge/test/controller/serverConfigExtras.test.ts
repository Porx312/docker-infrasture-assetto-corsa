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

function countField(content: string, field: string): number {
  return [...content.matchAll(new RegExp(`^${field}=`, 'gm'))].length;
}

test('applyServerConfiguration does not duplicate SERVER fields across multi-line sections', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-nodup-'));
  const prev = process.env.SERVERS_PATH;
  const name = 'server-2';
  process.env.SERVERS_PATH = tmp;
  try {
    const cfgDir = path.join(tmp, name, 'cfg');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgPath = path.join(cfgDir, 'server_cfg.ini');
    fs.writeFileSync(
      cfgPath,
      [
        '[SERVER]',
        'NAME=old',
        'PASSWORD=',
        'ADMIN_PASSWORD=admin123',
        'UDP_PORT=9620',
        'TCP_PORT=9620',
        'HTTP_PORT=8083',
        'MAX_CLIENTS=3',
        'CARS=old_car',
        'TRACK=old_track',
        'CONFIG_TRACK=',
        'SUN_ANGLE=64',
        'TIME_OF_DAY_MULT=1',
        'TYRE_BLANKETS_ALLOWED=1',
        '',
        '[PRACTICE]',
        'NAME=akina practice',
        'TIME=1440',
        'IS_OPEN=1',
        '',
        '[WEATHER_0]',
        'GRAPHICS=3_clear',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(cfgDir, 'cm_wrapper_params.json'),
      JSON.stringify({ port: 18083 }),
      'utf-8',
    );

    const result = applyServerConfiguration(name, {
      displayName: 'test',
      timeOfDay: 'night',
      track: 'west_zao_s',
      maxClients: 3,
      password: '',
      tyreBlanketsAllowed: true,
    });
    assert.equal(result.ok, true);
    const content = fs.readFileSync(cfgPath, 'utf-8');

    assert.equal(countField(content, 'SUN_ANGLE'), 1);
    assert.equal(countField(content, 'TIME_OF_DAY_MULT'), 1);
    assert.equal(countField(content, 'TRACK'), 1);
    assert.equal(countField(content, 'MAX_CLIENTS'), 1);
    assert.equal(countField(content, 'TYRE_BLANKETS_ALLOWED'), 1);
    assert.equal(countField(content, 'PASSWORD'), 1);
    assert.equal(countField(content, 'NAME'), 2); // SERVER + PRACTICE
    assert.match(content, /^SUN_ANGLE=-80$/m);
    assert.match(content, /\[PRACTICE\]\s*\nNAME=test\n/);
    assert.match(content, /^ADMIN_PASSWORD=admin123$/m);
  } finally {
    if (prev !== undefined) process.env.SERVERS_PATH = prev;
    else delete process.env.SERVERS_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
