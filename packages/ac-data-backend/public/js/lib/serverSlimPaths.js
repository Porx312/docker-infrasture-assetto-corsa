/**
 * Mirror of packages/ac-data-shared/src/mods/serverSlimPaths.ts
 * Keep in sync — see contentTreeHash.test / serverSlimPaths parity checks.
 */

/** @typedef {'car' | 'track' | 'weather'} ServerSlimKind */

const SKIP_BASENAMES = new Set(['.acmod.json', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * @param {string} rel
 * @returns {string}
 */
export function normalizeRelPath(rel) {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * @param {string} rel
 * @param {ServerSlimKind} kind
 * @returns {boolean}
 */
export function isServerSlimRelativePath(rel, kind) {
  const r = normalizeRelPath(rel);
  if (!r || r.includes('..')) return false;
  const base = r.split('/').pop() || '';
  if (SKIP_BASENAMES.has(base) || base.startsWith('._')) return false;

  if (kind === 'car') {
    if (r === 'data.acd') return true;
    if (r === 'data' || r.startsWith('data/')) return true;
    if (r === 'ui/ui_car.json') return true;
    if (/^skins\/[^/]+\/ui_skin\.json$/i.test(r)) return true;
    if (/^skins\/[^/]+\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.test(r)) return true;
    return false;
  }

  if (kind === 'track') {
    if (r === 'models.ini' || /^models_[^/]+\.ini$/i.test(r)) return true;
    if (/^(?:[^/]+\/)?data\/surfaces\.ini$/i.test(r)) return true;
    if (/^(?:[^/]+\/)?data\/drs_zones\.ini$/i.test(r)) return true;
    if (/^ui\/.*\/ui_track\.json$/i.test(r) || r === 'ui/ui_track.json') return true;
    if (/^ui\/.*\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.test(r)) return true;
    if (/^ui\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.test(r)) return true;
    return false;
  }

  if (/\.(kn5|dds|fbx|obj|blend)$/i.test(r)) return false;
  if (r.startsWith('data/') || r === 'data') return true;
  if (/\.(ini|json|lut)$/i.test(r)) return true;
  return false;
}

/**
 * @param {string[]} relPaths
 * @param {ServerSlimKind} kind
 * @returns {string[]}
 */
export function filterServerSlimRelPaths(relPaths, kind) {
  return relPaths.map(normalizeRelPath).filter((r) => isServerSlimRelativePath(r, kind));
}
