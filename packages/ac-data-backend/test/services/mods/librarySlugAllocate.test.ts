import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateLibrarySlug,
  displayNameForAllocatedSlug,
  LIBRARY_SLUG_MAX_CN,
} from '../../../src/services/mods/librarySlugAllocate.js';

test('allocateLibrarySlug returns requested when free', async () => {
  const taken = new Set<string>();
  const r = await allocateLibrarySlug('my_car', {
    slugTaken: async (s) => taken.has(s),
  });
  assert.equal(r.slug, 'my_car');
  assert.equal(r.requestedSlug, 'my_car');
  assert.equal(r.allocated, false);
  assert.equal(r.suffix, null);
});

test('allocateLibrarySlug uses -c1 when base taken', async () => {
  const taken = new Set(['pk_gunma']);
  const r = await allocateLibrarySlug('pk_gunma', {
    slugTaken: async (s) => taken.has(s),
  });
  assert.equal(r.slug, 'pk_gunma-c1');
  assert.equal(r.allocated, true);
  assert.equal(r.suffix, 'c1');
});

test('allocateLibrarySlug skips taken -c1 and uses -c2', async () => {
  const taken = new Set(['foo', 'foo-c1']);
  const r = await allocateLibrarySlug('foo', {
    slugTaken: async (s) => taken.has(s),
  });
  assert.equal(r.slug, 'foo-c2');
  assert.equal(r.suffix, 'c2');
  assert.equal(r.allocated, true);
});

test('allocateLibrarySlug throws when -cN exhausted', async () => {
  const taken = async (s: string) =>
    s === 'bar' || /^bar-c\d+$/.test(s);
  await assert.rejects(
    () => allocateLibrarySlug('bar', { maxSuffix: 3, slugTaken: taken }),
    (err: unknown) =>
      err instanceof Error && err.message.startsWith('slug_allocate_exhausted'),
  );
});

test('allocateLibrarySlug rejects empty or unsafe slug', async () => {
  await assert.rejects(() => allocateLibrarySlug(''), /slug_required/);
  await assert.rejects(() => allocateLibrarySlug('a/b'), /slug_required/);
  await assert.rejects(() => allocateLibrarySlug('..'), /slug_required/);
});

test('LIBRARY_SLUG_MAX_CN is 99', () => {
  assert.equal(LIBRARY_SLUG_MAX_CN, 99);
});

test('displayNameForAllocatedSlug appends (cN) when name equals requested slug', () => {
  assert.equal(displayNameForAllocatedSlug('my_car', 'my_car', 'c1'), 'my_car (c1)');
  assert.equal(displayNameForAllocatedSlug('Cool Car', 'my_car', 'c1'), 'Cool Car');
  assert.equal(displayNameForAllocatedSlug('my_car', 'my_car', null), 'my_car');
});
