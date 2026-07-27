import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCmDescription, normalizeBranding } from './serverBranding.js';

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
});

test('buildCmDescription includes banner img BBCode', () => {
  const branding = normalizeBranding({
    description: 'Lobby text',
    webLink: 'https://projectd.space',
    cmDescriptionBody: 'Rich body',
    loadingImageUrl: 'https://example.com/load.png',
    bannerImageUrl: 'https://example.com/banner.png',
  });
  const cm = buildCmDescription(branding);
  assert.match(cm, /^\[img=https:\/\/example.com\/banner.png\]ProjectD\[\/img\]/);
  assert.match(cm, /Rich body/);
});
