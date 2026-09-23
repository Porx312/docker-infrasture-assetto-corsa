import { apiGet } from './api.js';
import {
  getFleetRegionFilter,
  setFleetMode,
  setFleetRegionFilter,
} from './fleet.js';

/**
 * @param {HTMLElement | null} selectEl
 */
export async function initFleetSelector(selectEl, labelEl) {
  if (!selectEl) {
    return;
  }

  const { res, data } = await apiGet('/fleet/edges');
  if (!res.ok || !data?.ok) {
    labelEl?.classList.add('hidden');
    setFleetMode(false);
    return;
  }

  const edges = data.edges ?? [];
  if (!data.fleetMode || edges.length === 0) {
    labelEl?.classList.add('hidden');
    setFleetMode(false);
    return;
  }

  setFleetMode(true);
  labelEl?.classList.remove('hidden');
  if (labelEl) {
    labelEl.textContent = 'Region filter';
  }

  const saved = getFleetRegionFilter();
  selectEl.innerHTML =
    `<option value="">All regions</option>` +
    edges
      .map(
        (edge) =>
          `<option value="${escapeAttr(edge.id)}"${edge.id === saved ? ' selected' : ''}>${escapeHtml(edge.label)}</option>`,
      )
      .join('');

  selectEl.addEventListener('change', () => {
    setFleetRegionFilter(selectEl.value);
    window.dispatchEvent(new CustomEvent('fleet-edge-changed'));
  });
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s);
}
