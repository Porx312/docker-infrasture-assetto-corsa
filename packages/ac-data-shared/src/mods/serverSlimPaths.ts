/**
 * Content Manager Pack–style allowlist for dedicated-server content.
 * acServer only needs checksum / physics files — not kn5/dds/models for clients.
 */

export type ServerSlimKind = 'car' | 'track' | 'weather';

const SKIP_BASENAMES = new Set(['.acmod.json', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** Normalize to forward-slash relative path without leading ./ */
export function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * True when `rel` (relative to cars/<slug> or tracks/<slug>) is needed on the server
 * (plus small admin stubs for inventory/previews).
 */
export function isServerSlimRelativePath(rel: string, kind: ServerSlimKind): boolean {
  const r = normalizeRelPath(rel);
  if (!r || r.includes('..')) return false;
  const base = r.split('/').pop() || '';
  if (SKIP_BASENAMES.has(base) || base.startsWith('._')) return false;

  if (kind === 'car') {
    if (r === 'data.acd') return true;
    if (r === 'data' || r.startsWith('data/')) return true;
    if (r === 'ui/ui_car.json') return true;
    // skins/<name>/ui_skin.json and small previews only
    const skinUi = /^skins\/[^/]+\/ui_skin\.json$/i.exec(r);
    if (skinUi) return true;
    const skinPrev = /^skins\/[^/]+\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.exec(r);
    if (skinPrev) return true;
    return false;
  }

  if (kind === 'track') {
    if (r === 'models.ini' || /^models_[^/]+\.ini$/i.test(r)) return true;
    // layout/data/surfaces.ini, layout/data/drs_zones.ini (or root data/)
    if (/^(?:[^/]+\/)?data\/surfaces\.ini$/i.test(r)) return true;
    if (/^(?:[^/]+\/)?data\/drs_zones\.ini$/i.test(r)) return true;
    // ui stubs + previews
    if (/^ui\/.*\/ui_track\.json$/i.test(r) || r === 'ui/ui_track.json') return true;
    if (/^ui\/.*\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.test(r)) return true;
    if (/^ui\/preview[^/]*\.(jpg|jpeg|png|webp)$/i.test(r)) return true;
    return false;
  }

  // weather: keep data + ini + json, skip large textures if obvious
  if (/\.(kn5|dds|fbx|obj|blend)$/i.test(r)) return false;
  if (r.startsWith('data/') || r === 'data') return true;
  if (/\.(ini|json|lut)$/i.test(r)) return true;
  return false;
}

export function filterServerSlimRelPaths(relPaths: string[], kind: ServerSlimKind): string[] {
  return relPaths.map(normalizeRelPath).filter((r) => isServerSlimRelativePath(r, kind));
}
