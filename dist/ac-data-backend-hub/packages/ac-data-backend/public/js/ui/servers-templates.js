import { escapeAttr, escapeHtml } from '../lib/dom.js';
import {
  bindBrandingPreview,
  brandingRefs,
  fillBranding,
  readBranding,
  renderBrandingFieldsHtml,
} from '../lib/branding.js';

export const GLOBAL_BRANDING_REFS = brandingRefs('br', { loadingListMode: true });

export function renderServersPanelHtml() {
  return `
    <div class="panel" data-type="servers">
      <div class="panel-header">
        <h2>Server branding</h2>
        <span class="panel-count" id="serversCount"></span>
      </div>
      <p class="panel-note">Global branding on the hub (when configured). Per-instance overrides use the row actions and target the correct VPS.</p>
      <form id="brandingForm" class="branding-form" novalidate>
        ${renderBrandingFieldsHtml(GLOBAL_BRANDING_REFS, {
          descriptionRows: 3,
          cmBodyRows: 5,
          bannerLabel: 'Banner image (CM description)',
          loadingLabel: 'Loading screen images',
          loadingListMode: true,
        })}
        <div class="branding-actions">
          <button type="submit" class="btn btn-primary" id="brSaveBtn">Save global branding</button>
        </div>
      </form>
      <div class="server-table-section">
        <p class="modal-mod-section">Instances</p>
        <div id="serverTableWrap" class="admin-table-wrap"></div>
      </div>
    </div>
  `;
}

export function renderServerTableSkeleton() {
  return `
    <table class="admin-table">
      <thead><tr><th>Region</th><th>Folder</th><th>Lobby name</th><th>Wrapper</th><th></th></tr></thead>
      <tbody><tr><td colspan="5" class="admin-table-muted">Loading…</td></tr></tbody>
    </table>
  `;
}

/**
 * @param {Array<{ name: string; displayName?: string | null; wrapperPort?: number | null; fleetEdgeId?: string; fleetLabel?: string }>} servers
 * @param {boolean} showRegion
 */
export function renderServerTableHtml(servers, showRegion = false) {
  if (!servers?.length) {
    return '<p class="branding-preview-empty">No server instances found</p>';
  }

  const rows = servers
    .map((server) => {
      const regionCell = showRegion
        ? `<td>${escapeHtml(server.fleetLabel || '—')}</td>`
        : '';
      return `
    <tr>
      ${regionCell}
      <td><code>${escapeHtml(server.name)}</code></td>
      <td>${escapeHtml(server.displayName || server.name)}</td>
      <td>${server.wrapperPort != null ? escapeHtml(String(server.wrapperPort)) : '—'}</td>
      <td class="admin-table-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-server-config="${escapeAttr(server.name)}" data-fleet-edge-id="${escapeAttr(server.fleetEdgeId || '')}">Branding</button>
      </td>
    </tr>`;
    })
    .join('');

  const regionHead = showRegion ? '<th>Region</th>' : '';
  return `
    <table class="admin-table">
      <thead>
        <tr>${regionHead}<th>Folder</th><th>Lobby name</th><th>Wrapper</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export { bindBrandingPreview, fillBranding, readBranding };
