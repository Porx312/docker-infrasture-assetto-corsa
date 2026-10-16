/**
 * Browser mirror of contentHashFromFileEntries (ac-data-shared).
 */

import { normalizeRelPath } from './serverSlimPaths.js';

/**
 * @param {ArrayBuffer | ArrayBufferView} buf
 * @returns {Promise<string>}
 */
export async function sha256Hex(buf) {
  /** @type {BufferSource} */
  let source;
  if (ArrayBuffer.isView(buf)) {
    source = buf;
  } else {
    source = buf;
  }
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Array<{ rel: string; size: number; sha256: string }>} entries
 * @returns {Promise<string>}
 */
export async function contentHashFromFileEntries(entries) {
  const sorted = entries
    .map((e) => ({
      rel: normalizeRelPath(e.rel),
      size: e.size,
      sha256: String(e.sha256 || '').toLowerCase(),
    }))
    .filter((e) => e.rel && !e.rel.includes('..'))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const lines = sorted.map((e) => `${e.rel}\0${e.size}\0${e.sha256}`);
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}
