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
        <h2>Servers</h2>
        <span class="panel-count" id="serversCount"></span>
      </div>
      <div class="servers-panel-actions">
        <button type="button" class="btn btn-primary" id="globalBrandingOpenBtn">Apply branding to servers…</button>
        <button type="button" class="btn btn-sm" id="serverProvisionOpenBtn">Add instance…</button>
      </div>
      <p class="panel-note">Bulk branding uses checkboxes. Per instance: Manage for lifecycle, lobby cfg, and CM branding.</p>
      <div class="server-table-section">
        <p class="modal-mod-section">Instances</p>
        <div id="serverTableWrap" class="admin-table-wrap"></div>
      </div>
    </div>
  `;
}

/** @param {string} name @param {string} fleetEdgeId */
export function serverTargetKey(name, fleetEdgeId = '') {
  return `${fleetEdgeId}\t${name}`;
}

/**
 * @param {Array<{ name: string; displayName?: string | null; fleetEdgeId?: string; fleetLabel?: string }>} servers
 * @param {Set<string>} selectedKeys
 * @param {boolean} showRegion
 */
export function renderGlobalBrandingTargetsHtml(servers, selectedKeys, showRegion = false) {
  if (!servers?.length) return '';

  return servers
    .map((server) => {
      const fleetEdgeId = server.fleetEdgeId || '';
      const key = serverTargetKey(server.name, fleetEdgeId);
      const checked = selectedKeys.has(key) ? ' checked' : '';
      const region = showRegion && server.fleetLabel ? `${server.fleetLabel} · ` : '';
      const label = `${region}${server.displayName || server.name}`;
      const meta = server.displayName && server.displayName !== server.name ? server.name : '';
      return `
    <label class="global-branding-target">
      <input type="checkbox" name="globalBrandingTarget"${checked} data-server-name="${escapeAttr(server.name)}" data-fleet-edge-id="${escapeAttr(fleetEdgeId)}" data-target-key="${escapeAttr(key)}" />
      <span class="global-branding-target-text">
        <span class="global-branding-target-name">${escapeHtml(label)}</span>
        ${meta ? `<span class="global-branding-target-meta"><code>${escapeHtml(meta)}</code></span>` : ''}
      </span>
    </label>`;
    })
    .join('');
}

export function renderServerTableSkeleton(showRegion = false) {
  const regionHead = showRegion ? '<th>Region</th>' : '';
  const cols = (showRegion ? 1 : 0) + 5;
  return `
    <table class="admin-table">
      <thead><tr>${regionHead}<th>Status</th><th>Folder</th><th>Lobby name</th><th>Wrapper</th><th></th></tr></thead>
      <tbody><tr><td colspan="${cols}" class="admin-table-muted">Loading…</td></tr></tbody>
    </table>
  `;
}

/**
 * @param {{ running?: boolean; label?: string } | undefined} runtime
 */
export function formatServerStatusCell(runtime) {
  if (!runtime?.label) {
    return '<span class="server-status-badge server-status-unknown">…</span>';
  }
  const mod = runtime.running ? 'server-status-running' : 'server-status-stopped';
  return `<span class="server-status-badge ${mod}">${escapeHtml(runtime.label)}</span>`;
}

/**
 * @param {Array<{ name: string; displayName?: string | null; wrapperPort?: number | null; fleetEdgeId?: string; fleetLabel?: string }>} servers
 * @param {boolean} showRegion
 * @param {Map<string, { running?: boolean; label?: string }>} [runtimeByKey]
 */
export function renderServerTableHtml(servers, showRegion = false, runtimeByKey = new Map()) {
  if (!servers?.length) {
    return '<p class="branding-preview-empty">No server instances found</p>';
  }

  const rows = servers
    .map((server) => {
      const regionCell = showRegion
        ? `<td>${escapeHtml(server.fleetLabel || '—')}</td>`
        : '';
      const key = serverTargetKey(server.name, server.fleetEdgeId || '');
      const statusCell = formatServerStatusCell(runtimeByKey.get(key));
      return `
    <tr>
      ${regionCell}
      <td>${statusCell}</td>
      <td><code>${escapeHtml(server.name)}</code></td>
      <td>${escapeHtml(server.displayName || server.name)}</td>
      <td>${server.wrapperPort != null ? escapeHtml(String(server.wrapperPort)) : '—'}</td>
      <td class="admin-table-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-server-config="${escapeAttr(server.name)}" data-fleet-edge-id="${escapeAttr(server.fleetEdgeId || '')}">Manage</button>
      </td>
    </tr>`;
    })
    .join('');

  const regionHead = showRegion ? '<th>Region</th>' : '';
  return `
    <table class="admin-table">
      <thead>
        <tr>${regionHead}<th>Status</th><th>Folder</th><th>Lobby name</th><th>Wrapper</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export { bindBrandingPreview, fillBranding, readBranding };
