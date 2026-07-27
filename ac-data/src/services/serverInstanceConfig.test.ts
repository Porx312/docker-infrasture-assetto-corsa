import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCmDescription } from './serverInstanceConfig.js';

test('parseCmDescription extracts banner and body', () => {
  const parsed = parseCmDescription(
    '[img=https://example.com/banner.png]ProjectD[/img]\n\nHello [url=https://x.com]x[/url]',
  );
  assert.equal(parsed.bannerImageUrl, 'https://example.com/banner.png');
  assert.equal(parsed.body, 'Hello [url=https://x.com]x[/url]');
});

test('parseCmDescription returns full text when no banner', () => {
  const parsed = parseCmDescription('Plain CM body');
  assert.equal(parsed.bannerImageUrl, '');
  assert.equal(parsed.body, 'Plain CM body');
});
