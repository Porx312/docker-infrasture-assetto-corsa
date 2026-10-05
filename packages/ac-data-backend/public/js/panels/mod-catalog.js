import { apiGet, apiPost, apiFetch, apiDelete, apiPostForm, apiPatch } from '../lib/api.js';
import { emptyStateHtml, escapeAttr, escapeHtml, formatSize } from '../lib/dom.js';
import { distNeedsPolling, renderModSyncStatusCell } from '../lib/modSyncStatus.js';
import { hideUploadOverlay, showConfirm, showUploadOverlay } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { getTab } from '../config/tabs.js';
import { skeletonHtml } from '../ui/content-templates.js';

/** @type {Record<string, object[]>} */
const packagesByType = { cars: [], tracks: [] };

/** @type {Record<string, string>} */
const categoryFilterByType = { cars: '', tracks: '' };

const CATEGORY_SUGGESTIONS = ['drift', 'pack', 'touge', 'circuit', 'street', 'traffic', 'time attack'];

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
  const category =
    typeof pkg.category === 'string' && pkg.category.trim() ? pkg.category.trim() : '';
  const thumbInner = imageUrl
    ? `<img class="mod-card-thumb-img" src="${escapeAttr(imageUrl)}" alt="" loading="lazy">`
    : `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`;

  return `
    <article class="mod-card-wrap" data-package-id="${escapeAttr(pkg.id)}" data-artifact-id="${artifactId}">
      <button type="button" class="mod-card" data-open-catalog="${type}" data-artifact-id="${artifactId}" data-package-id="${escapeAttr(pkg.id)}" data-package-name="${escapeAttr(pkg.display_name)}">
        <div class="mod-card-thumb">${thumbInner}</div>
        <div class="mod-card-name">${escapeHtml(pkg.display_name)}</div>
        <div class="mod-card-meta">${slug} · ${meta}</div>
        ${category ? `<span class="mod-card-category">${escapeHtml(category)}</span>` : ''}
      </button>
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
      <div class="mod-category-filters" id="${type}CategoryFilters" aria-label="Filter by category"></div>
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
      <div class="mod-catalog-workspace" id="${type}Workspace">
        <div id="${type}List" class="content-grid"></div>
        <div id="${type}DistDetail" class="mod-dist-detail hidden"></div>
      </div>
    </div>
  `;
  bindModCatalogPanel(type);
}

/** @param {string} type */
function bindModCatalogPanel(type) {
  document.getElementById(`${type}Search`)?.addEventListener('input', () => filterCatalog(type));
  document.getElementById(`${type}CategoryFilters`)?.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-category-filter]') : null;
    if (!(btn instanceof HTMLElement)) return;
    categoryFilterByType[type] = btn.getAttribute('data-category-filter') || '';
    filterCatalog(type);
  });

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
function renderCategoryFilters(type) {
  const el = document.getElementById(`${type}CategoryFilters`);
  if (!el) return;
  const items = packagesByType[type] || [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  let uncategorized = 0;
  for (const pkg of items) {
    const cat =
      typeof pkg.category === 'string' && pkg.category.trim() ? pkg.category.trim().toLowerCase() : '';
    if (!cat) {
      uncategorized += 1;
      continue;
    }
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const active = categoryFilterByType[type] || '';
  const cats = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const chips = [
    `<button type="button" class="mod-category-chip${active === '' ? ' active' : ''}" data-category-filter="">All (${items.length})</button>`,
    ...cats.map(
      (cat) =>
        `<button type="button" class="mod-category-chip${active === cat ? ' active' : ''}" data-category-filter="${escapeAttr(cat)}">${escapeHtml(cat)} (${counts.get(cat)})</button>`,
    ),
  ];
  if (uncategorized > 0) {
    chips.push(
      `<button type="button" class="mod-category-chip${active === '__none__' ? ' active' : ''}" data-category-filter="__none__">Uncategorized (${uncategorized})</button>`,
    );
  }
  el.innerHTML = cats.length || uncategorized ? chips.join('') : '';
}

/** @param {string} type */
function filterCatalog(type) {
  const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
  const filteredSpan = document.getElementById(`${type}Filtered`);
  const list = document.getElementById(`${type}List`);
  if (!list) return;

  const term = (searchInput?.value || '').toLowerCase().trim();
  const categoryFilter = categoryFilterByType[type] || '';
  const items = packagesByType[type] || [];
  const filtered = items.filter((pkg) => {
    const cat =
      typeof pkg.category === 'string' && pkg.category.trim()
        ? pkg.category.trim().toLowerCase()
        : '';
    if (categoryFilter === '__none__' && cat) return false;
    if (categoryFilter && categoryFilter !== '__none__' && cat !== categoryFilter) return false;
    if (!term) return true;
    const hay = `${pkg.display_name} ${pkg.ac_content_slug} ${pkg.slug} ${cat}`.toLowerCase();
    return hay.includes(term);
  });

  // Group by category for easier scanning (uncategorized last).
  filtered.sort((a, b) => {
    const ca =
      typeof a.category === 'string' && a.category.trim() ? a.category.trim().toLowerCase() : '~~~';
    const cb =
      typeof b.category === 'string' && b.category.trim() ? b.category.trim().toLowerCase() : '~~~';
    if (ca !== cb) return ca.localeCompare(cb);
    return String(a.display_name || '').localeCompare(String(b.display_name || ''));
  });

  if (filteredSpan) {
    filteredSpan.textContent = `${filtered.length} of ${items.length}`;
  }

  renderCategoryFilters(type);

  if (!filtered.length) {
    list.innerHTML = emptyStateHtml(
      items.length ? 'No matches' : `No ${type} in mod catalog yet — upload a ZIP`,
    );
    return;
  }

  list.innerHTML = filtered.map((pkg) => renderCatalogCard(pkg, type)).join('');
  highlightSelectedCatalogCard(type);
}

/**
 * @param {string} type
 * @param {string | null | undefined} packageId
 */
function setCatalogWorkspaceOpen(type, packageId) {
  const workspace = document.getElementById(`${type}Workspace`);
  workspace?.classList.toggle('is-open', Boolean(packageId));
  highlightSelectedCatalogCard(type, packageId);
}

/**
 * @param {string} type
 * @param {string | null | undefined} [packageId]
 */
function highlightSelectedCatalogCard(type, packageId) {
  const detail = document.getElementById(`${type}DistDetail`);
  const activeId =
    packageId ??
    detail?.querySelector('[data-edit-package-id]')?.getAttribute('data-edit-package-id') ??
    '';
  const list = document.getElementById(`${type}List`);
  if (!list) return;
  for (const wrap of list.querySelectorAll('.mod-card-wrap')) {
    wrap.classList.toggle('is-selected', wrap.getAttribute('data-package-id') === activeId);
  }
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
    closeCatalogSidePanel(type);
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
    const pkg = (packagesByType[type] || []).find((p) => p.id === packageId);
    const artifactId = pkg?.latest_artifact?.id;
    if (artifactId) {
      await openCatalogDistribution(type, artifactId, pkg?.display_name, { packageId });
    }
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
    const pkg = (packagesByType[type] || []).find((p) => p.id === packageId);
    const artifactId = pkg?.latest_artifact?.id;
    if (artifactId) {
      await openCatalogDistribution(type, artifactId, pkg?.display_name, { packageId });
    }
  } catch {
    showToast('Could not remove preview', 'error');
  }
}

/** @param {string} type */
function closeCatalogSidePanel(type) {
  stopCatalogDistPoll(type);
  const detail = document.getElementById(`${type}DistDetail`);
  if (detail) {
    detail.classList.add('hidden');
    detail.innerHTML = '';
  }
  setCatalogWorkspaceOpen(type, null);
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
    showToast(`Registered ${file.name} — open the card to sync to VPS`, 'success');
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
 * Open side panel: edit metadata + distribution.
 * @param {string} type
 * @param {string} artifactId
 * @param {string} [displayName]
 * @param {{ preserveSelection?: boolean; quiet?: boolean; packageId?: string }} [opts]
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

  const packageId =
    opts.packageId ||
    detail.querySelector('[data-edit-package-id]')?.getAttribute('data-edit-package-id') ||
    (packagesByType[type] || []).find((p) => p.latest_artifact?.id === artifactId)?.id ||
    '';

  if (opts.quiet && detail.querySelector('.mod-side-panel')) {
    const { data } = await apiGet(`/mods/artifacts/${artifactId}/distribution`);
    if (!data.ok) return;
    const rows = data.distribution || [];
    const tbody = detail.querySelector('.mod-dist-table tbody');
    if (tbody) {
      tbody.innerHTML = rows
        .map((row) => {
          const checked =
            !prevSelected || prevSelected.has(row.edge_id) ? ' checked' : '';
          return `<tr>
              <td><input type="checkbox" class="mod-edge-check" value="${escapeAttr(row.edge_id)}"${checked} /></td>
              <td>${escapeHtml(row.label || row.edge_id)}</td>
              <td>${renderModSyncStatusCell(row)}</td>
            </tr>`;
        })
        .join('');
    }
    const liveHint = detail.querySelector('[data-dist-live-hint]');
    if (liveHint) {
      liveHint.textContent = distNeedsPolling(rows) ? ' · Updating live…' : '';
    }
    if (distNeedsPolling(rows)) {
      if (catalogDistPollArtifact[type] !== artifactId) {
        stopCatalogDistPoll(type);
        catalogDistPollArtifact[type] = artifactId;
        catalogDistPollTimers[type] = setInterval(() => {
          void openCatalogDistribution(type, artifactId, displayName, {
            preserveSelection: true,
            quiet: true,
            packageId,
          });
        }, 2000);
      }
    } else {
      stopCatalogDistPoll(type);
    }
    return;
  }

  if (!opts.quiet) {
    detail.classList.remove('hidden');
    detail.innerHTML = '<p class="panel-hint">Loading…</p>';
    setCatalogWorkspaceOpen(type, packageId || null);
  }

  const { data } = await apiGet(`/mods/artifacts/${artifactId}/distribution`);
  if (!data.ok) {
    stopCatalogDistPoll(type);
    detail.innerHTML = `<p class="panel-hint">${data.message || 'Failed to load distribution'}</p>`;
    setCatalogWorkspaceOpen(type, packageId || null);
    return;
  }

  const art = data.artifact;
  const rows = data.distribution || [];
  const pkg =
    (packagesByType[type] || []).find((p) => p.id === packageId) ||
    (packagesByType[type] || []).find((p) => p.latest_artifact?.id === artifactId);
  const resolvedPackageId = pkg?.id || packageId || art?.package?.id || '';
  const title = displayName || pkg?.display_name || art?.package?.display_name || 'Mod';
  const imageUrl =
    typeof pkg?.imageUrl === 'string' && pkg.imageUrl
      ? pkg.imageUrl
      : '';
  const acSlug = pkg?.ac_content_slug || art?.package?.ac_content_slug || '';
  const category =
    (typeof pkg?.category === 'string' && pkg.category) ||
    (typeof art?.package?.category === 'string' && art.package.category) ||
    '';

  detail.classList.remove('hidden');
  setCatalogWorkspaceOpen(type, resolvedPackageId || null);
  detail.innerHTML = `
    <aside class="mod-side-panel card" data-edit-package-id="${escapeAttr(resolvedPackageId)}">
      <header class="mod-side-panel-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="panel-hint">v${escapeHtml(art?.version_label || '')}<span data-dist-live-hint>${
            distNeedsPolling(rows) ? ' · Updating live…' : ''
          }</span></p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-close-dist="${type}">Close</button>
      </header>

      <section class="mod-edit-section">
        <p class="modal-mod-section">Edit</p>
        <div class="mod-edit-preview">
          <div class="mod-edit-preview-thumb">
            ${
              imageUrl
                ? `<img src="${escapeAttr(imageUrl)}" alt="" loading="lazy">`
                : `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`
            }
          </div>
          <div class="mod-edit-preview-actions">
            <input type="file" class="hidden" data-side-preview-input accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif">
            <button type="button" class="btn btn-sm" data-side-preview-upload>${imageUrl ? 'Replace image' : 'Upload image'}</button>
            ${imageUrl ? '<button type="button" class="btn btn-sm btn-ghost" data-side-preview-remove>Remove image</button>' : ''}
          </div>
        </div>
        <div class="form-group">
          <label for="${type}ModDisplayName">Display name</label>
          <input class="input" type="text" id="${type}ModDisplayName" value="${escapeAttr(title)}" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="${type}ModCategory">Category</label>
          <input class="input" type="text" id="${type}ModCategory" list="${type}ModCategoryList" value="${escapeAttr(category)}" placeholder="drift, pack, touge…" autocomplete="off">
          <datalist id="${type}ModCategoryList">
            ${CATEGORY_SUGGESTIONS.map((c) => `<option value="${escapeAttr(c)}"></option>`).join('')}
          </datalist>
          <p class="field-hint">Extra label to group mods (not car/track — that comes from this tab).</p>
        </div>
        <div class="form-group">
          <label for="${type}ModAcSlug">AC content slug</label>
          <input class="input" type="text" id="${type}ModAcSlug" value="${escapeAttr(acSlug)}" autocomplete="off">
        </div>
        <div class="mod-edit-actions">
          <button type="button" class="btn btn-primary btn-sm" data-side-save>Save changes</button>
          <button type="button" class="btn btn-danger btn-sm" data-side-delete>Delete mod</button>
        </div>
      </section>

      <section class="mod-dist-section">
        <p class="modal-mod-section">VPS distribution</p>
        <p class="panel-hint">Sync copies from a READY VPS (peer pull) when the ZIP is edge-owned — hub does not store master blobs for those. Remove deletes content on the selected VPS only.</p>
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
        <div class="modal-actions mod-side-dist-actions">
          <button type="button" class="btn btn-primary btn-sm" data-sync-edges="${escapeAttr(artifactId)}">Sync / copy to selected</button>
          <button type="button" class="btn btn-ghost btn-sm" data-verify-edges="${escapeAttr(artifactId)}">Verify</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove-edges="${escapeAttr(artifactId)}">Remove from VPS</button>
        </div>
      </section>
    </aside>
  `;

  detail.querySelector(`[data-close-dist="${type}"]`)?.addEventListener('click', () => {
    closeCatalogSidePanel(type);
  });

  const fileInput = /** @type {HTMLInputElement | null} */ (
    detail.querySelector('[data-side-preview-input]')
  );
  detail.querySelector('[data-side-preview-upload]')?.addEventListener('click', () => {
    fileInput?.click();
  });
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file && resolvedPackageId) void uploadModPreview(type, resolvedPackageId, file);
  });
  detail.querySelector('[data-side-preview-remove]')?.addEventListener('click', () => {
    if (resolvedPackageId) void removeModPreview(type, resolvedPackageId);
  });

  detail.querySelector('[data-side-save]')?.addEventListener('click', () => {
    if (resolvedPackageId) void saveCatalogPackageMeta(type, resolvedPackageId, artifactId);
  });
  detail.querySelector('[data-side-delete]')?.addEventListener('click', () => {
    if (resolvedPackageId) void deleteCatalogPackage(type, resolvedPackageId, title);
  });

  const selectedEdges = () =>
    [...detail.querySelectorAll('.mod-edge-check:checked')].map(
      (el) => /** @type {HTMLInputElement} */ (el).value,
    );

  detail.querySelector('[data-sync-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/distribute`, { edgeIds });
    showToast(res.ok ? `Enqueued ${res.enqueued} jobs` : res.message, res.ok ? 'success' : 'error');
    await openCatalogDistribution(type, artifactId, displayName, { packageId: resolvedPackageId });
  });

  detail.querySelector('[data-verify-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/verify`, { edgeIds });
    showToast(res.ok ? `Verify enqueued (${res.enqueued})` : res.message, res.ok ? 'success' : 'error');
  });

  detail.querySelector('[data-remove-edges]')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    if (!edgeIds.length) {
      showToast('Select at least one VPS', 'error');
      return;
    }
    const ok = await showConfirm(
      'Remove from VPS?',
      `Delete this mod from ${edgeIds.length} selected VPS (local pool + blob). Catalog metadata stays on the hub.`,
      'Remove',
    );
    if (!ok) return;
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/remove-from-edges`, { edgeIds });
    showToast(res.ok ? 'Remove scheduled' : res.message, res.ok ? 'success' : 'error');
    await openCatalogDistribution(type, artifactId, displayName, { packageId: resolvedPackageId });
  });

  if (distNeedsPolling(rows)) {
    if (catalogDistPollArtifact[type] !== artifactId) {
      stopCatalogDistPoll(type);
      catalogDistPollArtifact[type] = artifactId;
      catalogDistPollTimers[type] = setInterval(() => {
        void openCatalogDistribution(type, artifactId, displayName, {
          preserveSelection: true,
          quiet: true,
          packageId: resolvedPackageId,
        });
      }, 2000);
    }
  } else {
    stopCatalogDistPoll(type);
  }
}

/**
 * @param {string} type
 * @param {string} packageId
 * @param {string} artifactId
 */
async function saveCatalogPackageMeta(type, packageId, artifactId) {
  const nameEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById(`${type}ModDisplayName`)
  );
  const categoryEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById(`${type}ModCategory`)
  );
  const slugEl = /** @type {HTMLInputElement | null} */ (
    document.getElementById(`${type}ModAcSlug`)
  );
  const display_name = nameEl?.value.trim() || '';
  const category = categoryEl?.value.trim() || '';
  const ac_content_slug = slugEl?.value.trim() || '';
  if (!display_name) {
    showToast('Display name is required', 'error');
    return;
  }
  if (!ac_content_slug) {
    showToast('AC content slug is required', 'error');
    return;
  }

  try {
    const { res, data } = await apiPatch(`/mods/packages/${encodeURIComponent(packageId)}`, {
      display_name,
      category,
      ac_content_slug,
    });
    if (!res.ok || !data.ok) {
      showToast(data.message || 'Could not save', 'error');
      return;
    }
    showToast('Mod updated', 'success');
    await loadModCatalog(type);
    await openCatalogDistribution(type, artifactId, display_name, { packageId });
  } catch {
    showToast('Could not save', 'error');
  }
}
