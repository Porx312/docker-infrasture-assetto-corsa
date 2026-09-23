import { apiGet, apiPost, apiFetch } from '../lib/api.js';
import { showToast } from '../lib/toast.js';

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)} MB`;
  return `${num} B`;
}

function statusBadge(status) {
  const cls =
    status === 'READY'
      ? 'badge-ok'
      : status === 'ERROR'
        ? 'badge-danger'
        : status === 'SYNCING'
          ? 'badge-warn'
          : 'badge-muted';
  return `<span class="badge ${cls}">${status}</span>`;
}

/** @param {HTMLElement} root */
export function mountModDistributionPanel(root) {
  root.innerHTML = `
    <section class="panel-section">
      <header class="panel-header">
        <div>
          <h2>Mod distribution</h2>
          <p class="panel-hint">Upload to hub staging → SHA-256 → distribute to VPS edges</p>
        </div>
      </header>
      <div class="mod-dist-upload card">
        <h3>Upload mod (ZIP)</h3>
        <form id="modDistUploadForm" class="mod-dist-form">
          <label>Display name <input class="input" name="displayName" required /></label>
          <label>Version <input class="input" name="versionLabel" value="1.0" required /></label>
          <label>Kind
            <select class="input" name="kind">
              <option value="car">car</option>
              <option value="track">track</option>
              <option value="weather">weather</option>
              <option value="misc">misc</option>
            </select>
          </label>
          <label>ZIP file <input type="file" name="file" accept=".zip" required /></label>
          <label class="checkbox-row"><input type="checkbox" name="distributeAll" checked /> Distribute to all VPS after upload</label>
          <button type="submit" class="btn btn-primary">Upload &amp; register</button>
        </form>
        <p id="modDistUploadStatus" class="panel-hint"></p>
      </div>
      <div id="modDistCatalog" class="mod-dist-catalog"></div>
      <div id="modDistDetail" class="mod-dist-detail hidden"></div>
    </section>
  `;

  root.querySelector('#modDistUploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = /** @type {HTMLFormElement} */ (e.currentTarget);
    const statusEl = root.querySelector('#modDistUploadStatus');
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File)) return;
    if (statusEl) statusEl.textContent = 'Uploading…';
    const uploadFd = new FormData();
    uploadFd.append('file', file);
    const { res, data } = await apiFetch('/mods/upload', { method: 'POST', body: uploadFd });
    if (!res.ok || !data.uploadId) {
      showToast(data.message || 'Upload failed', 'error');
      if (statusEl) statusEl.textContent = '';
      return;
    }
    if (statusEl) statusEl.textContent = 'Finalizing (hash + storage)…';
    const distributeAll = form.querySelector('input[name="distributeAll"]');
    const distributeTo =
      distributeAll instanceof HTMLInputElement && distributeAll.checked ? 'all' : 'none';
    const { data: fin } = await apiPost(`/mods/upload/${data.uploadId}/finalize`, {
      displayName: fd.get('displayName'),
      versionLabel: fd.get('versionLabel'),
      kind: fd.get('kind'),
      distributeTo,
    });
    if (!fin.ok) {
      showToast(fin.message || 'Finalize failed', 'error');
      if (statusEl) statusEl.textContent = '';
      return;
    }
    showToast(`Mod registered (${fin.enqueued || 0} sync jobs)`, 'success');
    if (statusEl) statusEl.textContent = '';
    form.reset();
    await loadModDistributionPanel(root);
  });
}

/** @param {HTMLElement} root */
export async function loadModDistributionPanel(root) {
  const catalog = root.querySelector('#modDistCatalog');
  if (!catalog) return;
  const { data } = await apiGet('/mods');
  if (!data.ok) {
    catalog.innerHTML = `<p class="panel-hint">${data.message || 'Mod DB unavailable (set DATABASE_URL on hub)'}</p>`;
    return;
  }
  const packages = data.packages || [];
  if (!packages.length) {
    catalog.innerHTML = '<p class="panel-hint">No mods in catalog yet.</p>';
    return;
  }
  catalog.innerHTML = packages
    .map((pkg) => {
      const art = pkg.latest_artifact;
      const meta = art
        ? `v${art.version_label} · ${formatBytes(art.size_bytes)} · ${art.sha256.slice(0, 12)}…`
        : 'No artifact';
      return `<article class="card mod-dist-card" data-artifact-id="${art?.id || ''}">
        <h3>${pkg.display_name}</h3>
        <p class="panel-hint">${pkg.kind} · ${pkg.ac_content_slug} · ${meta}</p>
        <button type="button" class="btn btn-sm btn-ghost mod-dist-view" data-artifact-id="${art?.id || ''}">Distribution</button>
      </article>`;
    })
    .join('');

  catalog.querySelectorAll('.mod-dist-view').forEach((btn) => {
    btn.addEventListener('click', () => openDistributionDetail(root, btn.dataset.artifactId));
  });
}

/** @param {HTMLElement} root @param {string | undefined} artifactId */
async function openDistributionDetail(root, artifactId) {
  if (!artifactId) return;
  const detail = root.querySelector('#modDistDetail');
  if (!detail) return;
  detail.classList.remove('hidden');
  detail.innerHTML = '<p class="panel-hint">Loading…</p>';
  const { data } = await apiGet(`/mods/artifacts/${artifactId}/distribution`);
  if (!data.ok) {
    detail.innerHTML = `<p>${data.message || 'Failed'}</p>`;
    return;
  }
  const art = data.artifact;
  const rows = data.distribution || [];
  detail.innerHTML = `
    <div class="card">
      <h3>${art?.package?.display_name || 'Mod'} · v${art?.version_label || ''}</h3>
      <p class="panel-hint">${formatBytes(art?.size_bytes)} · SHA ${art?.sha256?.slice(0, 16)}…</p>
      <table class="mod-dist-table">
        <thead><tr><th></th><th>VPS</th><th>Status</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
              <td><input type="checkbox" class="mod-edge-check" value="${row.edge_id}" checked /></td>
              <td>${row.label}</td>
              <td>${statusBadge(row.status)} ${row.progress_pct ? Math.round(row.progress_pct) + '%' : ''}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="modSyncSelected">Sync selected</button>
        <button type="button" class="btn btn-ghost" id="modVerifySelected">Verify</button>
        <button type="button" class="btn btn-danger" id="modRemoveSelected">Remove from selected</button>
      </div>
    </div>
  `;

  const selectedEdges = () =>
    [...detail.querySelectorAll('.mod-edge-check:checked')].map((el) => /** @type {HTMLInputElement} */ (el).value);

  detail.querySelector('#modSyncSelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/distribute`, { edgeIds });
    showToast(res.ok ? `Enqueued ${res.enqueued} jobs` : res.message, res.ok ? 'success' : 'error');
    await openDistributionDetail(root, artifactId);
  });

  detail.querySelector('#modVerifySelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/verify`, { edgeIds });
    showToast(res.ok ? `Verify enqueued (${res.enqueued})` : res.message, res.ok ? 'success' : 'error');
  });

  detail.querySelector('#modRemoveSelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/remove-from-edges`, { edgeIds });
    showToast(res.ok ? 'Remove scheduled' : res.message, res.ok ? 'success' : 'error');
    await openDistributionDetail(root, artifactId);
  });
}

export async function refreshServerModsReadiness(serverName, fleetEdgeId) {
  const { data } = await apiGet(`/servers/${encodeURIComponent(serverName)}/mods/readiness`, fleetEdgeId);
  return data;
}

export async function syncMissingServerMods(serverName, fleetEdgeId) {
  const { data } = await apiPost(
    `/servers/${encodeURIComponent(serverName)}/mods/sync-missing`,
    {},
    fleetEdgeId,
  );
  return data;
}
