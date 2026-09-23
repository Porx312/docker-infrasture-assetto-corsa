import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCmDescription,
  MAX_LOADING_IMAGE_URLS,
  normalizeBranding,
  pickLoadingImageUrl,
} from './serverBranding.js';

test('normalizeBranding fills defaults and trims', () => {
  const branding = normalizeBranding({
    description: '  Hello  ',
    webLink: 'https://projectd.space',
    cmDescriptionBody: ' CM body ',
    loadingImageUrl: 'https://example.com/load.png',
  });
  assert.equal(branding.description, 'Hello');
  assert.equal(branding.cmDescriptionBody, 'CM body');
  assert.equal(branding.bannerImageUrl, 'https://example.com/load.png');
  assert.deepEqual(branding.loadingImageUrls, ['https://example.com/load.png']);
  assert.equal(branding.loadingImageUrl, 'https://example.com/load.png');
});

test('normalizeBranding dedupes loadingImageUrls and caps count', () => {
  const urls = Array.from(
    { length: MAX_LOADING_IMAGE_URLS + 5 },
    (_, i) => `https://example.com/load-${i}.png`,
  );
  const branding = normalizeBranding({
    loadingImageUrls: ['https://example.com/a.png', 'https://example.com/a.png', ...urls],
  });
  assert.equal(branding.loadingImageUrls.length, MAX_LOADING_IMAGE_URLS);
  assert.equal(branding.loadingImageUrls[0], 'https://example.com/a.png');
  assert.equal(branding.loadingImageUrl, 'https://example.com/a.png');
});

test('normalizeBranding prefers loadingImageUrls over legacy single field', () => {
  const branding = normalizeBranding({
    loadingImageUrl: 'https://example.com/legacy.png',
    loadingImageUrls: ['https://example.com/one.png', 'https://example.com/two.png'],
  });
  assert.deepEqual(branding.loadingImageUrls, [
    'https://example.com/one.png',
    'https://example.com/two.png',
  ]);
  assert.equal(branding.loadingImageUrl, 'https://example.com/one.png');
});

test('pickLoadingImageUrl returns empty for empty list', () => {
  assert.equal(pickLoadingImageUrl([]), '');
});

test('pickLoadingImageUrl uses randomFn for deterministic selection', () => {
  const urls = ['https://example.com/a.png', 'https://example.com/b.png'];
  assert.equal(pickLoadingImageUrl(urls, () => 0), 'https://example.com/a.png');
  assert.equal(pickLoadingImageUrl(urls, () => 0.99), 'https://example.com/b.png');
});

test('buildCmDescription includes banner img BBCode', () => {
  const branding = normalizeBranding({
    description: 'Lobby text',
    webLink: 'https://projectd.space',
    cmDescriptionBody: 'Rich body',
    loadingImageUrls: ['https://example.com/load.png'],
    bannerImageUrl: 'https://example.com/banner.png',
  });
  const cm = buildCmDescription(branding);
  assert.match(cm, /^\[img=https:\/\/example.com\/banner.png\]ProjectD\[\/img\]/);
  assert.match(cm, /Rich body/);
});
