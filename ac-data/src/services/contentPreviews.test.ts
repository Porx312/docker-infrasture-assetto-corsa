import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  findPreviewFile,
  listCarSkins,
  listTrackLayouts,
  previewContentType,
  resolveVariantPreviewPath,
} from './contentPreviews.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-content-previews-'));

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('findPreviewFile prefers preview.jpg', () => {
  const dir = path.join(tmpRoot, 'skin-a');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preview.jpg'), 'jpg');
  fs.writeFileSync(path.join(dir, 'preview.png'), 'png');
  assert.equal(findPreviewFile(dir)?.endsWith('preview.jpg'), true);
});

test('listCarSkins returns skin folder names from installed content', async () => {
  const skins = await listCarSkins('ks_mazda_rx7_spirit_r');
  assert.ok(skins.length >= 5);
  assert.ok(skins.some((skin) => skin.name === '00_blaze_red_b'));
});

test('listTrackLayouts returns ui layout folder names from installed content', async () => {
  const layouts = await listTrackLayouts('pk_akina');
  assert.ok(layouts.length >= 2);
  assert.ok(layouts.some((layout) => layout.name === 'akina_downhill'));
});

test('resolveVariantPreviewPath blocks path traversal', () => {
  assert.equal(resolveVariantPreviewPath('cars', '../secret', 'skin'), null);
  assert.equal(resolveVariantPreviewPath('cars', 'car', '../../etc/passwd'), null);
});

test('resolveVariantPreviewPath finds car skin preview', () => {
  const preview = resolveVariantPreviewPath('cars', 'ks_mazda_rx7_spirit_r', '00_blaze_red_b');
  assert.ok(preview);
  assert.equal(fs.existsSync(preview!), true);
});

test('resolveVariantPreviewPath finds track layout preview', () => {
  const preview = resolveVariantPreviewPath('tracks', 'pk_akina', 'akina_downhill');
  assert.ok(preview);
  assert.equal(fs.existsSync(preview!), true);
});

test('previewContentType maps extensions', () => {
  assert.equal(previewContentType('/tmp/preview.jpg'), 'image/jpeg');
  assert.equal(previewContentType('/tmp/preview.png'), 'image/png');
});
