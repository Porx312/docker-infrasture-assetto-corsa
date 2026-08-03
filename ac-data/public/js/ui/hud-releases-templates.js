import { escapeAttr, escapeHtml, formatDate, formatSize } from '../lib/dom.js';

export function renderHudReleasesPanelHtml() {
  return `
    <div class="panel" data-type="projectd-hud">
      <div class="panel-header">
        <div class="activity-panel-heading">
          <h2>ProjectD HUD</h2>
          <p class="activity-header-note">Overlay bundle (Lua/CSP) for desktop app sync via <code>/client/hud/*</code></p>
        </div>
        <span class="panel-count" id="hudReleaseCount"></span>
      </div>

      <div class="upload-dropzone" id="hudReleaseUpload">
        <p>Drag & drop a HUD release ZIP here</p>
        <p class="upload-hint">Example: projectd-hud-v1.0.0.zip</p>
        <input type="file" id="hudReleaseFileInput" accept=".zip,application/zip" hidden>
        <button type="button" class="btn btn-primary" id="hudReleaseSelectBtn">Select ZIP</button>
        <div class="progress-bar hidden" id="hudReleaseProgress">
          <div class="progress-bar-fill" id="hudReleaseProgressFill"></div>
        </div>
      </div>

      <div class="hud-releases-table-wrap">
        <table class="hud-releases-table" id="hudReleasesTable">
          <thead>
            <tr>
              <th>Version</th>
              <th>File</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>SHA256</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="hudReleasesBody"></tbody>
        </table>
        <p id="hudReleasesEmpty" class="activity-players-empty hidden">No HUD releases yet. Upload a ZIP above.</p>
      </div>
    </div>
  `;
}

/**
 * @param {Array<{ version: string; filename: string; size: number; uploadedAt: string; sha256: string }>} releases
 * @param {string | null} latest
 */
export function renderHudReleasesRowsHtml(releases, latest) {
  if (!releases?.length) return '';

  return releases
    .map((release) => {
      const isLatest = release.filename === latest;
      return `
    <tr class="hud-release-row${isLatest ? ' is-latest' : ''}">
      <td>${escapeHtml(release.version)}${isLatest ? ' <span class="activity-summary-filtered">Latest</span>' : ''}</td>
      <td><code>${escapeHtml(release.filename)}</code></td>
      <td>${escapeHtml(formatSize(release.size))}</td>
      <td>${escapeHtml(formatDate(release.uploadedAt))}</td>
      <td class="hud-sha-cell" title="${escapeAttr(release.sha256)}"><code>${escapeHtml(release.sha256.slice(0, 12))}…</code></td>
      <td class="hud-release-actions">
        <a class="btn btn-sm btn-ghost" href="/admin/hud/releases/${encodeURIComponent(release.filename)}/download">Download</a>
        <button type="button" class="btn btn-sm btn-danger hud-release-delete" data-filename="${escapeAttr(release.filename)}">Delete</button>
      </td>
    </tr>`;
    })
    .join('');
}
