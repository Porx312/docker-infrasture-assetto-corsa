import { apiGet, apiPost, apiFetch, apiDelete, apiPostForm } from '../lib/api.js';
import { emptyStateHtml, escapeAttr, escapeHtml, formatSize } from '../lib/dom.js';
import { distNeedsPolling, renderModSyncStatusCell } from '../lib/modSyncStatus.js';
import { hideUploadOverlay, showConfirm, showUploadOverlay } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { getTab } from '../config/tabs.js';
import { skeletonHtml } from '../ui/content-templates.js';

/** @type {Record<string, object[]>} */
const packagesByType = { cars: [], tracks: [] };

/** @type {Record<string, ReturnType<typeof setInterval> | null>} */
const catalogDistPollTimers = { cars: null, tracks: null };
/** @type {Record<string, string | null>} */
const catalogDistPollArtifact = { cars: null, tracks: null };

/** @param {string} type */
function stopCatalogDistPoll(type) {
  if (catalogDistPollTimers[type] != null) {
    clearInterval(catalogDistPollTimers[type]);
    catalogDistPollTimers[type] = null;
  }
  catalogDistPollArtifact[type] = null;
}

/** @param {string} type */
function kindForType(type) {
  return type === 'tracks' ? 'track' : 'car';
}

/**
 * @param {object} pkg
 * @param {string} type
 */
function renderCatalogCard(pkg, type) {
  const art = pkg.latest_artifact;
  const meta = art
    ? `v${escapeHtml(art.version_label)} · ${formatSize(Number(art.size_bytes))}`
    : 'No artifact';
  const slug = escapeHtml(pkg.ac_content_slug || pkg.slug || '');
  const artifactId = art?.id ? escapeAttr(art.id) : '';
  const imageUrl = typeof pkg.imageUrl === 'string' && pkg.imageUrl ? pkg.imageUrl : '';
  const thumbInner = imageUrl
    ? `<img class="mod-card-thumb-img" src="${escapeAttr(imageUrl)}" alt="" loading="lazy">`
    : `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`;

  return `
    <article class="mod-card-wrap" data-package-id="${escapeAttr(pkg.id)}" data-artifact-id="${artifactId}">
      <button type="button" class="mod-card" data-open-catalog="${type}" data-artifact-id="${artifactId}" data-package-name="${escapeAttr(pkg.display_name)}">
        <div class="mod-card-thumb">${thumbInner}</div>
        <div class="mod-card-name">${escapeHtml(pkg.display_name)}</div>
        <div class="mod-card-meta">${slug} · ${meta}</div>
      </button>
      <div class="mod-card-preview-actions">
        <input type="file" class="hidden" data-preview-input accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif">
        <button type="button" class="btn btn-sm" data-preview-upload>${imageUrl ? 'Replace image' : 'Upload image'}</button>
        ${imageUrl ? '<button type="button" class="btn btn-sm btn-danger" data-preview-remove>Remove</button>' : ''}
        <button type="button" class="btn btn-sm btn-danger" data-package-delete data-package-id="${escapeAttr(pkg.id)}" data-package-name="${escapeAttr(pkg.display_name)}">Delete</button>
      </div>
    </article>
  `;
}

/**
 * @param {string} type
 * @param {HTMLElement} container
 */
export function mountModCatalogPanel(type, container) {
  const tab = getTab(type);
  container.innerHTML = `
    <div class="panel" data-type="${type}" data-catalog="mods">
      <div class="panel-header">
        <h2>${tab.label}</h2>
        <div class="panel-search">
          <input type="text" class="input search-input" id="${type}Search" placeholder="Search ${tab.label.toLowerCase()}…">
          <span class="panel-count" id="${type}Filtered"></span>
        </div>
      </div>
      <div class="upload-dropzone" id="${type}Upload">
        <p>Drag &amp; drop a mod ZIP here</p>
        <p class="upload-hint">${tab.hint}</p>
        <input type="file" id="${type}FileInput" accept=".zip,application/zip">
        <button type="button" class="btn btn-primary" data-select="${type}">Choose ZIP</button>
        <div class="progress-bar" id="${type}Progress">
          <div class="progress-bar-fill" id="${type}ProgressFill"></div>
        </div>
      </div>
      <p id="${type}UploadStatus" class="panel-hint"></p>
      <div id="${type}List" class="content-grid"></div>
      <div id="${type}DistDetail" class="mod-dist-detail hidden"></div>
    </div>
  `;
  bindModCatalogPanel(type);
}

/** @param {string} type */
function bindModCatalogPanel(type) {
  document.getElementById(`${type}Search`)?.addEventListener('input', () => filterCatalog(type));

  const dropzone = document.getElementById(`${type}Upload`);
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', (e) => {
    e.currentTarget.classList.remove('dragover');
  });
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void confirmAndUploadZip(type, file);
  });

  document.getElementById(`${type}FileInput`)?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    if (file) void confirmAndUploadZip(type, file);
    input.value = '';
  });

  document.querySelector(`[data-select="${type}"]`)?.addEventListener('click', () => {
    document.getElementById(`${type}FileInput`)?.click();
  });
}

/** @param {string} type */
function filterCatalog(type) {
  const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
  const filteredSpan = document.getElementById(`${type}Filtered`);
  const list = document.getElementById(`${type}List`);
  if (!list) return;

  const term = (searchInput?.value || '').toLowerCase().trim();
  const items = packagesByType[type] || [];
  const filtered = term
    ? items.filter((pkg) => {
        const hay = `${pkg.display_name} ${pkg.ac_content_slug} ${pkg.slug}`.toLowerCase();
        return hay.includes(term);
      })
    : items;

  if (filteredSpan) {
    filteredSpan.textContent = `${filtered.length} of ${items.length}`;
  }

  if (!filtered.length) {
    list.innerHTML = emptyStateHtml(
      items.length ? 'No matches' : `No ${type} in mod catalog yet — upload a ZIP`,
    );
    return;
  }

  list.innerHTML = filtered.map((pkg) => renderCatalogCard(pkg, type)).join('');
  bindPreviewActions(type, list);
}

/**
 * @param {string} type
 * @param {HTMLElement} list
 */
function bindPreviewActions(type, list) {
  list.querySelectorAll('.mod-card-wrap').forEach((wrap) => {
    const packageId = wrap.getAttribute('data-package-id');
    if (!packageId) return;
    const fileInput = /** @type {HTMLInputElement | null} */ (
      wrap.querySelector('[data-preview-input]')
    );
    wrap.querySelector('[data-preview-upload]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput?.click();
    });
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void uploadModPreview(type, packageId, file);
    });
    wrap.querySelector('[data-preview-remove]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void removeModPreview(type, packageId);
    });
    wrap.querySelector('[data-package-delete]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name =
        /** @type {HTMLElement} */ (e.currentTarget).getAttribute('data-package-name') ||
        'this mod';
      void deleteCatalogPackage(type, packageId, name);
    });
  });
}

/**
 * @param {string} type
 * @param {string} packageId
 * @param {string} displayName
 */
async function deleteCatalogPackage(type, packageId, displayName) {
  const confirmed = await showConfirm(
    'Delete from catalog',
    `Delete "${displayName}" from the hub catalog (ZIP + metadata)? This cannot be undone. The VPS may keep a local cache until Remove / GC.`,
    'Delete',
  );
  if (!confirmed) return;
  try {
    const { res, data } = await apiDelete(`/mods/packages/${encodeURIComponent(packageId)}`);
    if (!res.ok || !data.ok) {
      showToast(data.message || 'Could not delete mod', 'error');
      return;
    }
    showToast(data.message || `Deleted ${displayName}`, 'success');
    stopCatalogDistPoll(type);
    const detail = document.getElementById(`${type}DistDetail`);
    if (detail && !detail.classList.contains('hidden')) {
      detail.classList.add('hidden');
      detail.innerHTML = '';
    }
    await loadModCatalog(type);
  } catch {
    showToast('Could not delete mod', 'error');
  }
}

/**
 * @param {string} type
 * @param {string} packageId
 * @param {File} file
 */
async function uploadModPreview(type, packageId, file) {
  if (!file.type.startsWith('image/')) {
    showToast('Only image files are allowed', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const { res, data } = await apiPostForm(`/mods/${encodeURIComponent(packageId)}/preview-image`, fd);
    if (!res.ok || !data.ok) {
      showToast(data.message || 'Preview upload failed', 'error');
      return;
    }
    showToast('Preview image saved', 'success');
    await loadModCatalog(type);
  } catch {
    showToast('Preview upload failed', 'error');
  }
}

/**
 * @param {string} type
 * @param {string} packageId
 */
async function removeModPreview(type, packageId) {
  const confirmed = await showConfirm('Remove preview image', 'This only removes the cover image, not the mod.', 'Remove');
  if (!confirmed) return;
  try {
    const { res, data } = await apiDelete(`/mods/${encodeURIComponent(packageId)}/preview-image`);
    if (!res.ok || !data.ok) {
      showToast(data.message || 'Could not remove preview', 'error');
      return;
    }
    showToast('Preview image removed', 'success');
    await loadModCatalog(type);
  } catch {
    showToast('Could not remove preview', 'error');
  }
}

/** @param {string} type */
export async function loadModCatalog(type) {
  const list = document.getElementById(`${type}List`);
  if (list) list.innerHTML = skeletonHtml(type);

  try {
    const { data } = await apiGet('/mods');
    if (!data.ok) {
      if (list) {
        list.innerHTML = emptyStateHtml(
          data.message || 'Mod catalog unavailable (set DATABASE_URL on hub)',
        );
      }
      return;
    }

    const kind = kindForType(type);
    packagesByType[type] = (data.packages || []).filter((pkg) => pkg.kind === kind);
    const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
    if (searchInput) searchInput.value = '';
    filterCatalog(type);
  } catch {
    if (list) list.innerHTML = emptyStateHtml('Connection error');
  }
}

/**
 * @param {string} type
 * @param {File} file
 */
async function confirmAndUploadZip(type, file) {
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.zip')) {
    showToast('Only .zip files are supported', 'error');
    return;
  }
  const confirmed = await showConfirm(
    `Upload ${type === 'tracks' ? 'track' : 'car'} ZIP`,
    file.name,
    'Upload',
  );
  if (!confirmed) return;
  await uploadCatalogZip(type, file);
}

/**
 * @param {string} type
 * @param {File} file
 */
async function uploadCatalogZip(type, file) {
  const statusEl = document.getElementById(`${type}UploadStatus`);
  const dropzone = document.getElementById(`${type}Upload`);
  const progressBar = document.getElementById(`${type}Progress`);
  const progressFill = document.getElementById(`${type}ProgressFill`);

  showUploadOverlay(`Uploading ${file.name}…`);
  dropzone?.classList.add('is-uploading');
  progressBar?.classList.add('show');
  if (progressFill) progressFill.style.width = '30%';
  if (statusEl) statusEl.textContent = `Uploading ${file.name}…`;

  try {
    const uploadFd = new FormData();
    uploadFd.append('file', file);
    const { res, data } = await apiFetch('/mods/upload', { method: 'POST', body: uploadFd });
    if (!res.ok || !data.uploadId) {
      showToast(data.message || 'Upload failed', 'error');
      return;
    }

    if (progressFill) progressFill.style.width = '70%';
    if (statusEl) statusEl.textContent = 'Finalizing (hash + storage)…';

    const { data: fin } = await apiPost(`/mods/upload/${data.uploadId}/finalize`, {
      kind: kindForType(type),
      distributeTo: 'none',
    });
    if (!fin.ok) {
      showToast(fin.message || 'Finalize failed', 'error');
      return;
    }

    if (progressFill) progressFill.style.width = '100%';
    showToast(`Registered ${file.name} — use Fleet deploy to sync VPS`, 'success');
    await loadModCatalog(type);
  } catch {
    showToast('Connection error', 'error');
  } finally {
    dropzone?.classList.remove('is-uploading');
    progressBar?.classList.remove('show');
    hideUploadOverlay();
    if (statusEl) statusEl.textContent = '';
  }
}

/**
 * Open distribution detail under the catalog panel.
 * @param {string} type
 * @param {string} artifactId
 * @param {string} [displayName]
 * @param {{ preserveSelection?: boolean; quiet?: boolean }} [opts]
 */
export async function openCatalogDistribution(type, artifactId, displayName, opts = {}) {
  if (!artifactId) {
    showToast('No artifact for this package yet', 'error');
    return;
  }
  const detail = document.getElementById(`${type}DistDetail`);
  if (!detail) return;

  /** @type {Set<string> | null} */
  let prevSelected = null;
  if (opts.preserveSelection) {
    prevSelected = new Set(
      [...detail.querySelectorAll('.mod-edge-check:checked')].map(
        (el) => /** @type {HTMLInputElement} */ (el).value,
      ),
    );
  }

  if (!opts.quiet) {
    detail.classList.remove('hidden');
    detail.innerHTML = '<p class="panel-hint">Loading distribution…</p>';
  }

  const { data } = await apiGet(`/mods/artifacts/${artifactId}/distribution`);
  if (!data.ok) {
    stopCatalogDistPoll(type);
    detail.innerHTML = `<p class="panel-hint">${data.message || 'Failed to load distribution'}</p>`;
    return;
  }

  const art = data.artifact;
  const rows = data.distribution || [];
  const title = displayName || art?.package?.display_name || 'Mod';

  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="card">
      <header class="panel-header">
        <div>
          <h3>${escapeHtml(title)} · v${escapeHtml(art?.version_label || '')}</h3>
          <p class="panel-hint">Edge status — sync from Fleet deploy or here${
            distNeedsPolling(rows) ? ' · Updating live…' : ''
          }</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-close-dist="${type}">Close</button>
      </header>
      <table class="mod-dist-table">
        <thead><tr><th></th><th>VPS</th><th>Status</th></tr></thead>
        <tbody>
          ${rows
            .map((row) => {
              const checked =
                !prevSelected || prevSelected.has(row.edge_id) ? ' checked' : '';
              return `<tr>
              <td><input type="checkbox" class="mod-edge-check" value="${escapeAttr(row.edge_id)}"${checked} /></td>
              <td>${escapeHtml(row.label || row.edge_id)}</td>
              <td>${renderModSyncStatusCell(row)}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-sync-edges="${escapeAttr(artifactId)}">Sync selected</button>
        <button type="button" class="btn btn-ghost" data-verify-edges="${escapeAttr(artifactId)}">Verify</button>
        <button type="button" class="btn btn-danger" data-remove-edges="${escapeAttr(artifactId)}">Remove from selected</button>
      </div>
    </div>
  `;

  detail.querySelector(`[data-close-dist="${type}"]`)?.addEventListener('click', () => {
    stopCatalogDistPoll(type);
    detail.classList.add('hidden');
    detail.innerHTML = '';
  });

  const selectedEdges = () =>
    [...detail.querySelectorAll('.mod-edge-check:checked')].map(
      (el) => /** @type {HTMLInputElement} */ (el).value,
    );

  detail.querySelector('[data-sync-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/distribute`, { edgeIds });
    showToast(res.ok ? `Enqueued ${res.enqueued} jobs` : res.message, res.ok ? 'success' : 'error');
    await openCatalogDistribution(type, artifactId, displayName);
  });

  detail.querySelector('[data-verify-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/verify`, { edgeIds });
    showToast(res.ok ? `Verify enqueued (${res.enqueued})` : res.message, res.ok ? 'success' : 'error');
  });

  detail.querySelector('[data-remove-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/remove-from-edges`, { edgeIds });
    showToast(res.ok ? 'Remove scheduled' : res.message, res.ok ? 'success' : 'error');
    await openCatalogDistribution(type, artifactId, displayName);
  });

  if (distNeedsPolling(rows)) {
    if (catalogDistPollArtifact[type] !== artifactId) {
      stopCatalogDistPoll(type);
      catalogDistPollArtifact[type] = artifactId;
      catalogDistPollTimers[type] = setInterval(() => {
        void openCatalogDistribution(type, artifactId, displayName, {
          preserveSelection: true,
          quiet: true,
        });
      }, 2000);
    }
  } else {
    stopCatalogDistPoll(type);
  }
}
