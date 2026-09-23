const FLEET_REGION_FILTER_KEY = 'adminFleetRegionFilter';

/** @type {boolean} */
let fleetMode = false;

export function isFleetMode() {
  return fleetMode;
}

export function setFleetMode(enabled) {
  fleetMode = Boolean(enabled);
}

/** Optional region filter for merged tables ('' = all). */
export function getFleetRegionFilter() {
  try {
    return sessionStorage.getItem(FLEET_REGION_FILTER_KEY) || '';
  } catch {
    return '';
  }
}

/** @param {string} edgeId */
export function setFleetRegionFilter(edgeId) {
  try {
    if (edgeId) {
      sessionStorage.setItem(FLEET_REGION_FILTER_KEY, edgeId);
    } else {
      sessionStorage.removeItem(FLEET_REGION_FILTER_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
export function appendFleetEdgeQuery(path) {
  return path;
}

/**
 * @param {string} path
 * @param {string} [fleetEdgeId]
 * @returns {string}
 */
export function withFleetEdgeQuery(path, fleetEdgeId) {
  const edge = (fleetEdgeId || '').trim();
  if (!edge) {
    return path;
  }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}fleetEdge=${encodeURIComponent(edge)}`;
}

/** @param {'content' | 'servers' | 'hud'} _kind */
export function requireFleetEdgeForPanel(_kind) {
  return true;
}

/**
 * @template {{ fleetEdgeId?: string; fleetLabel?: string }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function filterRowsByFleetRegion(rows) {
  const filter = getFleetRegionFilter();
  if (!filter || !fleetMode) {
    return rows;
  }
  return rows.filter((row) => row.fleetEdgeId === filter);
}
