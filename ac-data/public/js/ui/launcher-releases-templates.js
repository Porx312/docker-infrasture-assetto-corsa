import { escapeAttr, escapeHtml, formatDate, formatSize } from '../lib/dom.js';

export function renderLauncherReleasesPanelHtml() {
  return `
    <div class="panel" data-type="projectd-launcher">
      <div class="panel-header">
        <div class="activity-panel-heading">
          <h2>ProjectD Launcher</h2>
          <p class="activity-header-note">Desktop app bundle (Windows ZIP) for auto-update via <code>/client/launcher/*</code></p>
        </div>
        <span class="panel-count" id="launcherReleaseCount"></span>
      </div>

      <div class="upload-dropzone" id="launcherReleaseUpload">
        <p>Drag & drop a launcher release ZIP here</p>
        <p class="upload-hint">Example: projectd-launcher-v1.0.0.zip</p>
        <input type="file" id="launcherReleaseFileInput" accept=".zip,application/zip" hidden>
        <button type="button" class="btn btn-primary" id="launcherReleaseSelectBtn">Select ZIP</button>
        <div class="progress-bar hidden" id="launcherReleaseProgress">
          <div class="progress-bar-fill" id="launcherReleaseProgressFill"></div>
        </div>
      </div>

      <div class="hud-releases-table-wrap">
        <table class="hud-releases-table" id="launcherReleasesTable">
          <thead>
            <tr>
              <th>Version</th>
              <th>Platform</th>
              <th>File</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>SHA256</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="launcherReleasesBody"></tbody>
        </table>
        <p id="launcherReleasesEmpty" class="activity-players-empty hidden">No launcher releases yet. Upload a ZIP above.</p>
      </div>
    </div>
  `;
}

/**
 * @param {Array<{ version: string; filename: string; size: number; uploadedAt: string; sha256: string; platform?: string }>} releases
 * @param {string | null} latest
 */
export function renderLauncherReleasesRowsHtml(releases, latest) {
  if (!releases?.length) return '';

  return releases
    .map((release) => {
      const isLatest = release.filename === latest;
      const platform = release.platform || 'windows';
      return `
    <tr class="hud-release-row${isLatest ? ' is-latest' : ''}">
      <td>${escapeHtml(release.version)}${isLatest ? ' <span class="activity-summary-filtered">Latest</span>' : ''}</td>
      <td>${escapeHtml(platform)}</td>
      <td><code>${escapeHtml(release.filename)}</code></td>
      <td>${escapeHtml(formatSize(release.size))}</td>
      <td>${escapeHtml(formatDate(release.uploadedAt))}</td>
      <td class="hud-sha-cell" title="${escapeAttr(release.sha256)}"><code>${escapeHtml(release.sha256.slice(0, 12))}…</code></td>
      <td class="hud-release-actions">
        <a class="btn btn-sm btn-ghost" href="/admin/launcher/releases/${encodeURIComponent(release.filename)}/download">Download</a>
        <button type="button" class="btn btn-sm btn-danger launcher-release-delete" data-filename="${escapeAttr(release.filename)}">Delete</button>
      </td>
    </tr>`;
    })
    .join('');
}
