import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  getDownloadBlockedResponse,
  resetContentDistributionCatalogForTests,
  resolveContentDistribution,
} from './contentDistribution.js';

const testCatalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'config',
  'launcher-content-catalog.test.json',
);

test('ks_ cars default to steam_dlc', () => {
  resetContentDistributionCatalogForTests();
  const info = resolveContentDistribution('cars', 'ks_mazda_rx7_spirit_r');
  assert.equal(info.distribution, 'steam_dlc');
  assert.equal(info.downloadable, false);
  assert.ok(info.steamStoreUrl?.includes('steampowered.com'));
});

test('catalog steamDlc entry provides displayName', () => {
  resetContentDistributionCatalogForTests();
  const info = resolveContentDistribution('cars', 'ks_toyota_gt86');
  assert.equal(info.displayName, 'Toyota GT86');
});

test('non-ks mod cars are launcher downloadable', () => {
  resetContentDistributionCatalogForTests();
  const info = resolveContentDistribution('cars', 'ddm_mugen_civic_ek9');
  assert.equal(info.distribution, 'launcher');
  assert.equal(info.downloadable, true);
});

test('launcherDownloadable overrides ks_ prefix', () => {
  process.env.LAUNCHER_CONTENT_CATALOG_PATH = testCatalogPath;
  resetContentDistributionCatalogForTests();

  const info = resolveContentDistribution('cars', 'ks_test_override');
  assert.equal(info.distribution, 'launcher');

  delete process.env.LAUNCHER_CONTENT_CATALOG_PATH;
  resetContentDistributionCatalogForTests();
});

test('tracks default to launcher unless in steamDlc catalog', () => {
  resetContentDistributionCatalogForTests();
  const modTrack = resolveContentDistribution('tracks', 'pk_akina');
  assert.equal(modTrack.distribution, 'launcher');
  assert.equal(modTrack.downloadable, true);
});

test('getDownloadBlockedResponse includes steamStoreUrl', () => {
  resetContentDistributionCatalogForTests();
  const blocked = getDownloadBlockedResponse('cars', 'ks_mazda_miata');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.distribution, 'steam_dlc');
  assert.ok(blocked.steamStoreUrl);
});
