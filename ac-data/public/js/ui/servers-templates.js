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
      <p class="panel-note">Global branding applies to all instances. Click an instance below to override branding for that server only.</p>
      <form id="brandingForm" class="branding-form" novalidate>
        ${renderBrandingFieldsHtml(GLOBAL_BRANDING_REFS, {
          descriptionRows: 3,
          cmBodyRows: 5,
          bannerLabel: 'Banner image (CM description)',
          loadingLabel: 'Loading screen images',
          loadingListMode: true,
        })}
        <div class="branding-actions">
          <button type="submit" class="btn btn-primary" id="brSaveBtn">Save & apply to all servers</button>
        </div>
      </form>
      <div class="server-chip-section">
        <p class="modal-mod-section">Instances</p>
        <div id="serverChipList" class="server-chip-grid"></div>
      </div>
    </div>
  `;
}

/** @param {number} [count] */
export function renderServerChipsSkeleton(count = 4) {
  let html = '';
  for (let i = 0; i < count; i += 1) {
    html += `<div class="server-chip server-chip-skeleton skeleton-row" aria-hidden="true"></div>`;
  }
  return html;
}

/**
 * @param {Array<{ name: string; displayName?: string; wrapperPort?: number | null }>} servers
 */
export function renderServerChipsHtml(servers) {
  if (!servers?.length) {
    return '<p class="branding-preview-empty">No server instances found</p>';
  }

  return servers
    .map(
      (server) => `
    <button type="button" class="server-chip" data-server-name="${escapeAttr(server.name)}">
      <div class="server-chip-name">${escapeHtml(server.displayName || server.name)}</div>
      <div class="server-chip-meta">${escapeHtml(server.name)} · CM :${server.wrapperPort ?? '—'}</div>
    </button>
  `,
    )
    .join('');
}

export { bindBrandingPreview, fillBranding, readBranding };
