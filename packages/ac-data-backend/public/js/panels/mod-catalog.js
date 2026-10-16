import {
  apiGet,
  apiPost,
  apiDelete,
  apiPostForm,
  apiPutBinaryWithProgress,
  apiPatch,
} from '../lib/api.js';
import { emptyStateHtml, escapeAttr, escapeHtml, formatSize } from '../lib/dom.js';
import { distNeedsPolling, renderModSyncStatusCell } from '../lib/modSyncStatus.js';
import { showConfirm } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { getTab } from '../config/tabs.js';
import { skeletonHtml, renderVariantGrid, variantLabel, previewUrl } from '../ui/content-templates.js';
import { scanZipForSlimUpload, formatBytes } from '../lib/zipSlimScan.js';

/** @type {Record<string, object[]>} */
const packagesByType = { cars: [], tracks: [] };

/** @type {Record<string, object[]>} */
const inventoryByType = { cars: [], tracks: [] };

/** Shared across Cars / Tracks tabs. */
let catalogEdgeId = '';

/** @type {Array<{ id: string; label?: string }>} */
let catalogEdges = [];

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
 * @param {object} item inventory row
 * @param {string} type
 */
function inventorySlug(item, type) {
  if (type === 'tracks') return String(item.trackSlug || '').trim();
  return String(item.carModel || '').trim();
}

/**
 * @param {object} item
 * @param {string} type
 */
function findPackageForInventory(item, type) {
  const slug = inventorySlug(item, type).toLowerCase();
  if (!slug) return null;
  const packages = packagesByType[type] || [];
  const byArtifact =
    item.artifactId &&
    packages.find((p) => p.latest_artifact?.id === item.artifactId);
  if (byArtifact) return byArtifact;
  return (
    packages.find((p) => {
      const ac = String(p.ac_content_slug || '').trim().toLowerCase();
      const s = String(p.slug || '').trim().toLowerCase();
      return ac === slug || s === slug;
    }) || null
  );
}

/**
 * @param {object} item
 * @param {string} type
 */
function renderInventoryCard(item, type) {
  const slug = inventorySlug(item, type);
  const pkg = findPackageForInventory(item, type);
  const art = pkg?.latest_artifact;
  const artifactId = item.artifactId || art?.id || '';
  const packageId = pkg?.id || '';
  const displayName = pkg?.display_name || slug || 'Unknown';
  const skinCount = type === 'tracks' ? (item.configs || []).length : (item.skins || []).length;
  const metaBits =
    skinCount > 0
      ? `${skinCount} ${type === 'tracks' ? 'layouts' : 'skins'}`
      : '—';
  const sizeMeta = art ? ` · ${formatSize(Number(art.size_bytes))}` : '';
  const imageUrl = typeof pkg?.imageUrl === 'string' && pkg.imageUrl ? pkg.imageUrl : '';
  const category =
    typeof pkg?.category === 'string' && pkg.category.trim() ? pkg.category.trim() : '';
  let thumbInner = imageUrl
    ? `<img class="mod-card-thumb-img" src="${escapeAttr(imageUrl)}" alt="" loading="lazy">`
    : '';
  if (!thumbInner) {
    const firstVariant =
      type === 'tracks'
        ? (() => {
            const configs = item.configs || [];
            const named = configs.map((c) => String(c ?? '').trim()).find(Boolean);
            // Empty string = AC default layout; do not use track slug as a fake layout name.
            if (named) return named;
            if (configs.some((c) => c === '' || c == null)) return 'default';
            return '';
          })()
        : (item.skins || [])[0];
    if (firstVariant && slug && catalogEdgeId) {
      thumbInner = `<img class="mod-card-thumb-img" src="${escapeAttr(previewUrl(type, slug, String(firstVariant), catalogEdgeId))}" alt="" loading="lazy" onerror="this.classList.add('hidden'); this.nextElementSibling?.classList.remove('hidden');"><span class="mod-card-placeholder hidden">${type === 'tracks' ? 'T' : 'C'}</span>`;
    } else {
      thumbInner = `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`;
    }
  }
  const linked = Boolean(artifactId);
  const linkBadge = linked
    ? `<span class="mod-card-badge mod-card-badge--linked">Linked</span>`
    : `<span class="mod-card-badge mod-card-badge--local">Local only</span>`;
  const openAttrs = `data-open-catalog="${escapeAttr(type)}" data-artifact-id="${escapeAttr(artifactId)}" data-package-id="${escapeAttr(packageId)}" data-package-name="${escapeAttr(displayName)}" data-inv-slug="${escapeAttr(slug)}"`;

  return `
    <article class="mod-card-wrap" data-package-id="${escapeAttr(packageId)}" data-artifact-id="${escapeAttr(artifactId)}" data-inv-slug="${escapeAttr(slug)}">
      <button type="button" class="mod-card" ${openAttrs}>
        <div class="mod-card-thumb">${thumbInner}${linkBadge}</div>
        <div class="mod-card-name" title="${escapeAttr(displayName)}">${escapeHtml(displayName)}</div>
        <div class="mod-card-meta">${escapeHtml(metaBits)}${escapeHtml(sizeMeta)}</div>
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
          <input type="text" class="input search-input" id="${type}Search" placeholder="Search on this VPS…">
          <span class="panel-count" id="${type}Filtered"></span>
        </div>
      </div>
      <div class="fleet-inv-toolbar" id="${type}InvToolbar" style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:end;margin-bottom:0.75rem">
        <label>VPS
          <select id="${type}EdgeSelect" class="input"></select>
        </label>
        <button type="button" class="btn btn-ghost btn-sm" id="${type}InvRefreshBtn">Refresh</button>
      </div>
      <div class="upload-dropzone" id="${type}InvDropzone" tabindex="0" role="button" aria-label="Smart slim upload ZIP to selected VPS">
        <p>Drag & drop a car/track ZIP here</p>
        <p class="upload-hint">Smart upload: scans the ZIP in-browser, keeps only <strong>server-slim</strong> Pack files (~2&nbsp;MB), skips identical hashes, uploads changed files only. Full client kn5/dds never leave your PC.</p>
        <input type="file" id="${type}InvFile" accept=".zip,application/zip" hidden>
        <button type="button" class="btn btn-primary btn-sm" id="${type}InvPickBtn">Choose ZIP</button>
        <button type="button" class="btn btn-primary btn-sm" id="${type}InvUploadBtn" disabled>Upload to VPS</button>
        <div class="progress-bar" id="${type}InvProgress" hidden>
          <div class="progress-bar-fill" id="${type}InvProgressFill"></div>
        </div>
        <p class="panel-hint" id="${type}InvUploadStatus" hidden></p>
      </div>
      <p class="panel-hint" id="${type}InvHint">${escapeHtml(tab.hint)}</p>
      <div class="mod-category-filters" id="${type}CategoryFilters" aria-label="Filter by category"></div>
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
  document.getElementById(`${type}EdgeSelect`)?.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    catalogEdgeId = t.value;
    void loadModCatalog(type);
  });
  document.getElementById(`${type}InvRefreshBtn`)?.addEventListener('click', () => {
    void loadModCatalog(type);
  });

  const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}InvFile`));
  const dropzone = document.getElementById(`${type}InvDropzone`);
  const pickBtn = document.getElementById(`${type}InvPickBtn`);
  const uploadBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById(`${type}InvUploadBtn`)
  );

  const syncUploadEnabled = () => {
    if (uploadBtn) uploadBtn.disabled = !fileInput?.files?.length;
  };

  pickBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput?.click();
  });
  dropzone?.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    fileInput?.click();
  });
  fileInput?.addEventListener('change', () => {
    syncUploadEnabled();
    const file = fileInput.files?.[0];
    const status = document.getElementById(`${type}InvUploadStatus`);
    if (!status) return;
    if (!file) {
      status.hidden = true;
      status.textContent = '';
      return;
    }
    status.hidden = false;
    status.textContent = `Selected: ${file.name} (${formatSize(file.size)}) — scanning slim files…`;
    void previewSlimScan(type, file);
  });
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip') {
      showToast('Drop a .zip file', 'error');
      return;
    }
    if (!fileInput) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
  });
  uploadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void uploadInventorySlim(type);
  });
}

/** @type {Record<string, import('../lib/zipSlimScan.js').SlimZipScan | null>} */
const slimScanByType = { cars: null, tracks: null };

/**
 * @param {string} type
 * @param {File} file
 */
async function previewSlimScan(type, file) {
  const status = document.getElementById(`${type}InvUploadStatus`);
  try {
    const scan = await scanZipForSlimUpload(file, kindForType(type));
    slimScanByType[type] = scan;
    if (status) {
      status.textContent = `${file.name}: ${formatBytes(scan.rawBytes)} → ${formatBytes(scan.slimBytes)} (${scan.files.length} slim files, ${scan.slug})`;
    }
  } catch (err) {
    slimScanByType[type] = null;
    const message = err instanceof Error ? err.message : String(err);
    if (status) status.textContent = `Scan failed: ${message}`;
    showToast(message, 'error');
  }
}

/**
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<T[]>}
 */
async function runPool(tasks, concurrency, onProgress) {
  const results = /** @type {T[]} */ (new Array(tasks.length));
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      done += 1;
      onProgress?.(done, tasks.length);
    }
  }
  const n = Math.min(concurrency, tasks.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * @param {() => Promise<void>} fn
 * @param {number} [attempts]
 */
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** @param {string} type */
function fillEdgeSelect(type) {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById(`${type}EdgeSelect`));
  if (!select) return;
  if (!catalogEdges.length) {
    select.innerHTML = '<option value="">No VPS</option>';
    return;
  }
  if (!catalogEdgeId || !catalogEdges.some((e) => e.id === catalogEdgeId)) {
    catalogEdgeId = catalogEdges[0].id;
  }
  select.innerHTML = catalogEdges
    .map(
      (e) =>
        `<option value="${escapeAttr(e.id)}"${e.id === catalogEdgeId ? ' selected' : ''}>${escapeHtml(e.label || e.id)}</option>`,
    )
    .join('');
}

/**
 * @param {string} type
 * @returns {{
 *   fileInput: HTMLInputElement | null;
 *   btn: HTMLButtonElement | null;
 *   pickBtn: HTMLButtonElement | null;
 *   dropzone: HTMLElement | null;
 *   progress: HTMLElement | null;
 *   fill: HTMLElement | null;
 *   status: HTMLElement | null;
 * }}
 */
function uploadUi(type) {
  return {
    fileInput: /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}InvFile`)),
    btn: /** @type {HTMLButtonElement | null} */ (document.getElementById(`${type}InvUploadBtn`)),
    pickBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById(`${type}InvPickBtn`)),
    dropzone: document.getElementById(`${type}InvDropzone`),
    progress: document.getElementById(`${type}InvProgress`),
    fill: /** @type {HTMLElement | null} */ (document.getElementById(`${type}InvProgressFill`)),
    status: document.getElementById(`${type}InvUploadStatus`),
  };
}

/** Smart slim upload (default). @param {string} type */
async function uploadInventorySlim(type) {
  if (!catalogEdgeId) {
    showToast('No VPS selected', 'error');
    return;
  }
  const ui = uploadUi(type);
  const file = ui.fileInput?.files?.[0];
  if (!file) {
    showToast('Pick a ZIP first', 'error');
    return;
  }
  if (ui.btn) {
    ui.btn.disabled = true;
    ui.btn.textContent = 'Uploading…';
  }
  if (ui.pickBtn) ui.pickBtn.disabled = true;
  ui.dropzone?.classList.add('is-uploading');
  if (ui.progress) ui.progress.hidden = false;
  if (ui.fill) ui.fill.style.width = '0%';
  if (ui.status) {
    ui.status.hidden = false;
    ui.status.textContent = 'Scanning ZIP for server-slim files…';
  }

  try {
    const scan = await scanZipForSlimUpload(file, kindForType(type));
    slimScanByType[type] = scan;

    if (ui.status) {
      ui.status.textContent = `Planning ${scan.slug}: ${formatBytes(scan.rawBytes)} → ${formatBytes(scan.slimBytes)}…`;
    }

    const planBody = {
      kind: scan.kind,
      slug: scan.slug,
      displayName: file.name.replace(/\.zip$/i, ''),
      expectedContentHash: scan.expectedContentHash,
      files: scan.files.map(({ rel, size, sha256 }) => ({ rel, size, sha256 })),
    };
    const { data: plan } = await apiPost(
      `/mods/edges/${encodeURIComponent(catalogEdgeId)}/slim-upload/plan`,
      planBody,
    );
    if (!plan.ok) {
      showToast(String(plan.message || 'Plan failed'), 'error');
      if (ui.status) ui.status.textContent = String(plan.message || 'Plan failed');
      return;
    }

    if (plan.status === 'already_present') {
      if (ui.fill) ui.fill.style.width = '100%';
      showToast('Already installed (same contentHash) — nothing to upload', 'success');
      if (ui.status) ui.status.textContent = 'Already present on VPS';
      if (ui.fileInput) ui.fileInput.value = '';
      slimScanByType[type] = null;
      await loadModCatalog(type);
      return;
    }

    const sessionId = String(plan.sessionId || '');
    /** @type {Array<{ rel: string; size: number; sha256: string }>} */
    const needed = Array.isArray(plan.needed) ? plan.needed : [];
    if (!sessionId && needed.length) {
      showToast('Plan missing sessionId', 'error');
      return;
    }

    const byRel = new Map(scan.files.map((f) => [f.rel, f]));
    let uploadedBytes = 0;
    const totalBytes = needed.reduce((n, f) => n + f.size, 0);

    if (ui.status) {
      ui.status.textContent =
        needed.length === 0
          ? 'All slim files already on VPS — committing…'
          : `Uploading ${needed.length} file(s) (${formatBytes(totalBytes)})…`;
    }

    await runPool(
      needed.map((meta) => async () => {
        const local = byRel.get(meta.rel);
        if (!local) throw new Error(`Missing local bytes for ${meta.rel}`);
        await withRetry(async () => {
          const { data, res } = await apiPutBinaryWithProgress(
            `/mods/edges/${encodeURIComponent(catalogEdgeId)}/slim-upload/file`,
            local.bytes,
            {
              'X-Slim-Session-Id': sessionId,
              'X-Slim-Rel': meta.rel,
              'X-Slim-Sha256': meta.sha256,
            },
            (loaded) => {
              if (!ui.status) return;
              ui.status.textContent = `Uploading ${meta.rel}… ${formatBytes(loaded)} / ${formatBytes(meta.size)}`;
            },
          );
          if (!res.ok || !data.ok) {
            throw new Error(String(data.message || `PUT failed for ${meta.rel}`));
          }
        });
        uploadedBytes += meta.size;
        if (ui.fill && totalBytes > 0) {
          ui.fill.style.width = `${Math.min(99, Math.round((uploadedBytes / totalBytes) * 100))}%`;
        }
      }),
      3,
      (done, total) => {
        if (ui.status) {
          ui.status.textContent = `Uploaded ${done}/${total} files (${formatBytes(uploadedBytes)})…`;
        }
      },
    );

    if (ui.status) ui.status.textContent = 'Committing & verifying integrity…';
    const { data: commit } = await apiPost(
      `/mods/edges/${encodeURIComponent(catalogEdgeId)}/slim-upload/commit`,
      { sessionId },
    );
    if (!commit.ok) {
      showToast(String(commit.message || 'Commit failed'), 'error');
      if (ui.status) ui.status.textContent = String(commit.message || 'Commit failed');
      return;
    }

    if (ui.fill) ui.fill.style.width = '100%';
    let msg =
      String(commit.message || 'Installed') +
      (needed.length ? ` (${needed.length} uploaded, ${scan.files.length - needed.length} skipped)` : '');
    if (commit.hostCatalogSynced === false) {
      msg += ` — Convex sync skipped${commit.hostCatalogSyncError ? `: ${commit.hostCatalogSyncError}` : ''}`;
      showToast(msg, 'error');
    } else {
      showToast(msg, 'success');
    }
    if (ui.status) ui.status.textContent = msg;
    if (ui.fileInput) ui.fileInput.value = '';
    slimScanByType[type] = null;
    await loadModCatalog(type);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    showToast(message, 'error');
    if (ui.status) ui.status.textContent = message;
  } finally {
    if (ui.btn) {
      ui.btn.disabled = !ui.fileInput?.files?.length;
      ui.btn.textContent = 'Upload to VPS';
    }
    if (ui.pickBtn) ui.pickBtn.disabled = false;
    ui.dropzone?.classList.remove('is-uploading');
    if (ui.progress) {
      setTimeout(() => {
        ui.progress.hidden = true;
        if (ui.fill) ui.fill.style.width = '0%';
      }, 800);
    }
  }
}

/** @param {string} type */
function renderCategoryFilters(type) {
  const el = document.getElementById(`${type}CategoryFilters`);
  if (!el) return;
  const items = inventoryByType[type] || [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  let uncategorized = 0;
  for (const item of items) {
    const pkg = findPackageForInventory(item, type);
    const cat =
      typeof pkg?.category === 'string' && pkg.category.trim() ? pkg.category.trim().toLowerCase() : '';
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
  const items = inventoryByType[type] || [];
  const filtered = items.filter((item) => {
    const pkg = findPackageForInventory(item, type);
    const cat =
      typeof pkg?.category === 'string' && pkg.category.trim()
        ? pkg.category.trim().toLowerCase()
        : '';
    if (categoryFilter === '__none__' && cat) return false;
    if (categoryFilter && categoryFilter !== '__none__' && cat !== categoryFilter) return false;
    if (!term) return true;
    const slug = inventorySlug(item, type);
    const skins =
      type === 'tracks'
        ? (item.configs || []).join(' ')
        : (item.skins || []).join(' ');
    const hay = `${pkg?.display_name || ''} ${slug} ${skins} ${cat}`.toLowerCase();
    return hay.includes(term);
  });

  filtered.sort((a, b) => {
    const pa = findPackageForInventory(a, type);
    const pb = findPackageForInventory(b, type);
    const na = String(pa?.display_name || inventorySlug(a, type));
    const nb = String(pb?.display_name || inventorySlug(b, type));
    return na.localeCompare(nb);
  });

  if (filteredSpan) {
    filteredSpan.textContent = `${filtered.length} of ${items.length}`;
  }

  renderCategoryFilters(type);

  if (!filtered.length) {
    list.innerHTML = emptyStateHtml(
      items.length
        ? 'No matches'
        : catalogEdgeId
          ? `No ${type} on this VPS yet — drop a ZIP above (slim upload)`
          : 'No VPS registered',
    );
    return;
  }

  list.innerHTML = filtered.map((item) => renderInventoryCard(item, type)).join('');
  highlightSelectedCatalogCard(type);
}

/**
 * @param {string} type
 * @param {string | null | undefined} openKey packageId or artifactId or inv slug
 */
function setCatalogWorkspaceOpen(type, openKey) {
  const workspace = document.getElementById(`${type}Workspace`);
  workspace?.classList.toggle('is-open', Boolean(openKey));
  highlightSelectedCatalogCard(type, openKey);
}

/**
 * @param {string} type
 * @param {string | null | undefined} [openKey]
 */
function highlightSelectedCatalogCard(type, openKey) {
  const detail = document.getElementById(`${type}DistDetail`);
  const activeId =
    openKey ??
    detail?.querySelector('[data-panel-open-key]')?.getAttribute('data-panel-open-key') ??
    '';
  const list = document.getElementById(`${type}List`);
  if (!list) return;
  for (const wrap of list.querySelectorAll('.mod-card-wrap')) {
    const key =
      wrap.getAttribute('data-package-id') ||
      wrap.getAttribute('data-artifact-id') ||
      wrap.getAttribute('data-inv-slug') ||
      '';
    wrap.classList.toggle('is-selected', Boolean(activeId) && key === activeId);
  }
}

/**
 * @param {string} type
 * @param {string} [invSlug]
 * @param {string} [artifactId]
 * @param {string} [packageId]
 */
function findInventoryItem(type, invSlug, artifactId, packageId) {
  const items = inventoryByType[type] || [];
  if (artifactId) {
    const byArt = items.find((i) => String(i.artifactId || '') === artifactId);
    if (byArt) return byArt;
  }
  if (packageId) {
    const pkg = (packagesByType[type] || []).find((p) => p.id === packageId);
    const slug = String(pkg?.ac_content_slug || pkg?.slug || '').trim().toLowerCase();
    if (slug) {
      const byPkg = items.find((i) => inventorySlug(i, type).toLowerCase() === slug);
      if (byPkg) return byPkg;
    }
  }
  if (invSlug) {
    const needle = invSlug.trim().toLowerCase();
    return items.find((i) => inventorySlug(i, type).toLowerCase() === needle) || null;
  }
  return null;
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
  const hint = document.getElementById(`${type}InvHint`);

  try {
    const [{ data: edgesData }, { data: modsData }] = await Promise.all([
      apiGet('/mods/edges'),
      apiGet('/mods'),
    ]);

    catalogEdges = edgesData?.ok ? edgesData.edges || [] : [];
    fillEdgeSelect(type);

    const kind = kindForType(type);
    packagesByType[type] = modsData?.ok
      ? (modsData.packages || []).filter((pkg) => pkg.kind === kind)
      : [];

    if (!catalogEdgeId) {
      inventoryByType[type] = [];
      if (hint) hint.textContent = 'No VPS in FLEET_EDGE_REGISTRY yet.';
      filterCatalog(type);
      return;
    }

    const { data: inv } = await apiGet(`/mods/edges/${encodeURIComponent(catalogEdgeId)}/inventory`);
    if (!inv.ok) {
      inventoryByType[type] = [];
      if (hint) hint.textContent = inv.message || 'Inventory unavailable';
      filterCatalog(type);
      return;
    }

    inventoryByType[type] =
      type === 'tracks' ? inv.tracks || [] : inv.cars || [];
    const edgeLabel = inv.label || inv.edgeId || catalogEdgeId;
    const n = inventoryByType[type].length;
    if (hint) {
      hint.textContent = `${edgeLabel} · ${n} ${type} on disk. Slim-upload above; open a card to sync/copy/remove.`;
    }

    const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
    if (searchInput) searchInput.value = '';
    categoryFilterByType[type] = '';
    filterCatalog(type);
  } catch {
    if (list) list.innerHTML = emptyStateHtml('Connection error');
  }
}

/**
 * Open side panel: edit metadata + distribution + skins/layouts.
 * @param {string} type
 * @param {string} [artifactId]
 * @param {string} [displayName]
 * @param {{ preserveSelection?: boolean; quiet?: boolean; packageId?: string; invSlug?: string }} [opts]
 */
export async function openCatalogDistribution(type, artifactId, displayName, opts = {}) {
  const detail = document.getElementById(`${type}DistDetail`);
  if (!detail) return;

  const requestedArtifactId = String(artifactId || '').trim();
  const invSlugOpt = String(opts.invSlug || '').trim();

  // Quiet poll for a different mod must not clobber the open panel.
  if (opts.quiet) {
    if (catalogDistPollArtifact[type] !== requestedArtifactId || !requestedArtifactId) {
      return;
    }
    if (!detail.querySelector('.mod-side-panel')) return;
    const { data } = await apiGet(`/mods/artifacts/${requestedArtifactId}/distribution`);
    if (!data.ok || catalogDistPollArtifact[type] !== requestedArtifactId) return;
    const rows = data.distribution || [];
    /** @type {Set<string> | null} */
    let prevSelected = null;
    if (opts.preserveSelection) {
      prevSelected = new Set(
        [...detail.querySelectorAll('.mod-edge-check:checked')].map(
          (el) => /** @type {HTMLInputElement} */ (el).value,
        ),
      );
    }
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
      if (catalogDistPollTimers[type] == null) {
        catalogDistPollTimers[type] = setInterval(() => {
          void openCatalogDistribution(type, requestedArtifactId, displayName, {
            preserveSelection: true,
            quiet: true,
            packageId: opts.packageId,
            invSlug: invSlugOpt,
          });
        }, 2000);
      }
    } else {
      stopCatalogDistPoll(type);
    }
    return;
  }

  stopCatalogDistPoll(type);

  const packageIdHint =
    opts.packageId ||
    (packagesByType[type] || []).find((p) => p.latest_artifact?.id === requestedArtifactId)?.id ||
    '';

  const invItem = findInventoryItem(type, invSlugOpt, requestedArtifactId, packageIdHint);
  const slugFromInv = invItem ? inventorySlug(invItem, type) : invSlugOpt;
  const openKey = packageIdHint || requestedArtifactId || slugFromInv || 'open';

  detail.classList.remove('hidden');
  detail.innerHTML = '<p class="panel-hint">Loading…</p>';
  setCatalogWorkspaceOpen(type, openKey);

  /** @type {object | null} */
  let art = null;
  /** @type {object[]} */
  let rows = [];
  if (requestedArtifactId) {
    const { data } = await apiGet(`/mods/artifacts/${requestedArtifactId}/distribution`);
    if (!data.ok) {
      detail.innerHTML = `<p class="panel-hint">${escapeHtml(data.message || 'Failed to load distribution')}</p>`;
      setCatalogWorkspaceOpen(type, openKey);
      return;
    }
    art = data.artifact;
    rows = data.distribution || [];
  }

  const pkg =
    (packagesByType[type] || []).find((p) => p.id === packageIdHint) ||
    (packagesByType[type] || []).find((p) => p.latest_artifact?.id === requestedArtifactId) ||
    (slugFromInv
      ? (packagesByType[type] || []).find((p) => {
          const ac = String(p.ac_content_slug || '').trim().toLowerCase();
          const s = String(p.slug || '').trim().toLowerCase();
          const needle = slugFromInv.toLowerCase();
          return ac === needle || s === needle;
        })
      : null);

  const resolvedPackageId = pkg?.id || packageIdHint || art?.package?.id || '';
  const resolvedArtifactId = requestedArtifactId || pkg?.latest_artifact?.id || '';
  const acSlug =
    slugFromInv || pkg?.ac_content_slug || art?.package?.ac_content_slug || '';
  const title =
    displayName || pkg?.display_name || art?.package?.display_name || acSlug || 'Mod';
  const packageImageUrl =
    typeof pkg?.imageUrl === 'string' && pkg.imageUrl ? pkg.imageUrl : '';
  const category =
    (typeof pkg?.category === 'string' && pkg.category) ||
    (typeof art?.package?.category === 'string' && art.package.category) ||
    '';

  const variantNames =
    type === 'tracks'
      ? (invItem?.configs || []).map((c) => {
          const raw = c === '' || c == null ? '' : String(c).trim();
          // Empty config = AC default layout. Never show the track folder name as a layout.
          return raw || 'default';
        })
      : (invItem?.skins || []).map(String).filter(Boolean);

  const coverFromSkin =
    !packageImageUrl && acSlug && variantNames[0] && catalogEdgeId
      ? previewUrl(type, acSlug, variantNames[0], catalogEdgeId)
      : '';
  const coverUrl = packageImageUrl || coverFromSkin;
  const subtitleParts = [];
  if (art?.version_label) subtitleParts.push(`v${art.version_label}`);
  if (variantNames.length) {
    subtitleParts.push(
      `${variantNames.length} ${type === 'tracks' ? 'layouts' : 'skins'}`,
    );
  }
  if (acSlug && acSlug !== title) subtitleParts.push(acSlug);

  const variantsSection = acSlug
    ? `
      <section class="mod-edit-section">
        <p class="modal-mod-section">${escapeHtml(variantLabel(type))} on this VPS</p>
        ${
          variantNames.length
            ? renderVariantGrid(type, acSlug, variantNames, catalogEdgeId)
            : '<p class="panel-hint">No skins/layouts in inventory scan yet.</p>'
        }
      </section>`
    : '';

  const panelKey = resolvedPackageId || resolvedArtifactId || acSlug || openKey;
  catalogDistPollArtifact[type] = resolvedArtifactId || null;

  detail.classList.remove('hidden');
  setCatalogWorkspaceOpen(type, panelKey);
  detail.innerHTML = `
    <aside class="mod-side-panel card" data-edit-package-id="${escapeAttr(resolvedPackageId)}" data-panel-open-key="${escapeAttr(panelKey)}">
      <header class="mod-side-panel-header">
        <div>
          <h3 title="${escapeAttr(title)}">${escapeHtml(title)}</h3>
          <p class="panel-hint">${escapeHtml(subtitleParts.join(' · '))}<span data-dist-live-hint>${
            distNeedsPolling(rows) ? ' · Updating live…' : ''
          }</span></p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-close-dist="${type}">Close</button>
      </header>

      <section class="mod-edit-section">
        <div class="mod-edit-preview">
          <div class="mod-edit-preview-thumb">
            ${
              coverUrl
                ? `<img src="${escapeAttr(coverUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mod-card-placeholder',textContent:'${type === 'tracks' ? 'T' : 'C'}'}))">`
                : `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`
            }
          </div>
          ${
            resolvedPackageId
              ? `<div class="mod-edit-preview-actions">
            <input type="file" class="hidden" data-side-preview-input accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif">
            <button type="button" class="btn btn-sm" data-side-preview-upload>${packageImageUrl ? 'Replace cover' : 'Upload cover'}</button>
            ${packageImageUrl ? '<button type="button" class="btn btn-sm btn-ghost" data-side-preview-remove>Remove cover</button>' : ''}
          </div>`
              : ''
          }
        </div>
        ${
          resolvedPackageId
            ? `<div class="form-group">
          <label for="${type}ModDisplayName">Display name</label>
          <input class="input" type="text" id="${type}ModDisplayName" value="${escapeAttr(title)}" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="${type}ModCategory">Category</label>
          <input class="input" type="text" id="${type}ModCategory" list="${type}ModCategoryList" value="${escapeAttr(category)}" placeholder="drift, pack, touge…" autocomplete="off">
          <datalist id="${type}ModCategoryList">
            ${CATEGORY_SUGGESTIONS.map((c) => `<option value="${escapeAttr(c)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label for="${type}ModAcSlug">AC content slug</label>
          <input class="input" type="text" id="${type}ModAcSlug" value="${escapeAttr(acSlug)}" autocomplete="off">
        </div>
        <div class="mod-edit-actions">
          <button type="button" class="btn btn-primary btn-sm" data-side-save>Save changes</button>
          <button type="button" class="btn btn-danger btn-sm" data-side-delete>Delete mod</button>
        </div>`
            : ''
        }
      </section>

      ${variantsSection}

      ${
        resolvedArtifactId
          ? `<section class="mod-dist-section">
        <p class="modal-mod-section">VPS distribution</p>
        <p class="panel-hint">Sync copies from a READY VPS (peer pull). Remove deletes content on the selected VPS only. If the table is empty, use Delete folder on this VPS.</p>
        <table class="mod-dist-table">
          <thead><tr><th></th><th>VPS</th><th>Status</th></tr></thead>
          <tbody>
            ${(rows.length
              ? rows
              : catalogEdgeId
                ? [
                    {
                      edge_id: catalogEdgeId,
                      label:
                        catalogEdges.find((e) => e.id === catalogEdgeId)?.label || catalogEdgeId,
                      status: 'LOCAL_ONLY',
                    },
                  ]
                : []
            )
              .map((row) => {
                return `<tr>
                <td><input type="checkbox" class="mod-edge-check" value="${escapeAttr(row.edge_id)}" checked /></td>
                <td>${escapeHtml(row.label || row.edge_id)}</td>
                <td>${renderModSyncStatusCell(row)}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
        <div class="modal-actions mod-side-dist-actions">
          <button type="button" class="btn btn-primary btn-sm" data-sync-edges="${escapeAttr(resolvedArtifactId)}">Sync / copy to selected</button>
          <button type="button" class="btn btn-ghost btn-sm" data-verify-edges="${escapeAttr(resolvedArtifactId)}">Verify</button>
          <button type="button" class="btn btn-danger btn-sm" data-remove-edges="${escapeAttr(resolvedArtifactId)}">Remove from VPS</button>
          ${
            acSlug && catalogEdgeId
              ? `<button type="button" class="btn btn-danger btn-sm" data-delete-local-slug="${escapeAttr(acSlug)}" data-delete-local-kind="${escapeAttr(kindForType(type))}">Delete folder on this VPS</button>`
              : ''
          }
        </div>
      </section>`
          : `<section class="mod-dist-section">
        <p class="modal-mod-section">Local only</p>
        <p class="panel-hint">Folder is on <strong>${escapeHtml(catalogEdgeId || 'this VPS')}</strong> but not linked to the hub catalog yet. <strong>Adopt / Link to catalog</strong> indexes it (writes .acmod.json) so you can Sync to other VPS — no ZIP re-upload needed.</p>
        <div class="modal-actions mod-side-dist-actions">
          <button type="button" class="btn btn-primary btn-sm" data-adopt-local-slug="${escapeAttr(acSlug)}" data-adopt-local-kind="${escapeAttr(kindForType(type))}" data-adopt-display-name="${escapeAttr(displayName)}">Adopt / Link to catalog</button>
          <button type="button" class="btn btn-danger btn-sm" data-delete-local-slug="${escapeAttr(acSlug)}" data-delete-local-kind="${escapeAttr(kindForType(type))}">Delete from this VPS</button>
        </div>
      </section>`
      }
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
    if (resolvedPackageId && resolvedArtifactId) {
      void saveCatalogPackageMeta(type, resolvedPackageId, resolvedArtifactId);
    }
  });
  detail.querySelector('[data-side-delete]')?.addEventListener('click', () => {
    if (resolvedPackageId) void deleteCatalogPackage(type, resolvedPackageId, title);
  });

  const selectedEdges = () =>
    [...detail.querySelectorAll('.mod-edge-check:checked')].map(
      (el) => /** @type {HTMLInputElement} */ (el).value,
    );

  if (resolvedArtifactId) {
    detail.querySelector('[data-sync-edges]')?.addEventListener('click', async () => {
      const edgeIds = selectedEdges();
      const { data: res } = await apiPost(`/mods/artifacts/${resolvedArtifactId}/distribute`, {
        edgeIds,
      });
      showToast(res.ok ? `Enqueued ${res.enqueued} jobs` : res.message, res.ok ? 'success' : 'error');
      await openCatalogDistribution(type, resolvedArtifactId, displayName, {
        packageId: resolvedPackageId,
        invSlug: acSlug,
      });
    });

    detail.querySelector('[data-verify-edges]')?.addEventListener('click', async () => {
      const edgeIds = selectedEdges();
      const { data: res } = await apiPost(`/mods/artifacts/${resolvedArtifactId}/verify`, { edgeIds });
      showToast(res.ok ? `Verify enqueued (${res.enqueued})` : res.message, res.ok ? 'success' : 'error');
    });

    detail.querySelector('[data-remove-edges]')?.addEventListener('click', async () => {
      let edgeIds = selectedEdges();
      // Fallback: empty matrix / no checks → current inventory VPS
      if (!edgeIds.length && catalogEdgeId) edgeIds = [catalogEdgeId];
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
      const { data: res } = await apiPost(`/mods/artifacts/${resolvedArtifactId}/remove-from-edges`, {
        edgeIds,
      });
      showToast(res.ok ? 'Remove scheduled' : res.message, res.ok ? 'success' : 'error');
      await openCatalogDistribution(type, resolvedArtifactId, displayName, {
        packageId: resolvedPackageId,
        invSlug: acSlug,
      });
    });

    if (distNeedsPolling(rows)) {
      catalogDistPollTimers[type] = setInterval(() => {
        void openCatalogDistribution(type, resolvedArtifactId, displayName, {
          preserveSelection: true,
          quiet: true,
          packageId: resolvedPackageId,
          invSlug: acSlug,
        });
      }, 2000);
    }
  }

  detail.querySelector('[data-adopt-local-slug]')?.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement} */ (e.currentTarget);
    const slug = btn.getAttribute('data-adopt-local-slug') || '';
    const kind = btn.getAttribute('data-adopt-local-kind') || kindForType(type);
    const name = btn.getAttribute('data-adopt-display-name') || slug;
    if (!slug || !catalogEdgeId) {
      showToast('Missing slug or VPS', 'error');
      return;
    }
    btn.setAttribute('disabled', 'true');
    const { data: res } = await apiPost(`/mods/edges/${encodeURIComponent(catalogEdgeId)}/adopt`, {
      kind,
      slug,
      displayName: name,
    });
    btn.removeAttribute('disabled');
    if (!res.ok) {
      showToast(res.message || 'Adopt failed', 'error');
      return;
    }
    showToast(res.message || 'Linked to catalog', 'success');
    await loadModCatalog(type);
    const newArtifactId = res.artifactId || '';
    if (newArtifactId) {
      await openCatalogDistribution(type, newArtifactId, name, {
        packageId: res.packageId || '',
        invSlug: slug,
      });
    } else {
      closeCatalogSidePanel(type);
    }
  });

  // Local folder delete (works with or without catalog artifact — for orphans / empty matrix).
  detail.querySelector('[data-delete-local-slug]')?.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement} */ (e.currentTarget);
    const slug = btn.getAttribute('data-delete-local-slug') || '';
    const kind = btn.getAttribute('data-delete-local-kind') || kindForType(type);
    if (!slug || !catalogEdgeId) {
      showToast('Missing slug or VPS', 'error');
      return;
    }
    const ok = await showConfirm(
      'Delete folder on this VPS?',
      `Permanently delete ${kind}s/${slug} from ${catalogEdgeId}.`,
      'Delete',
    );
    if (!ok) return;
    const { data: res } = await apiDelete(
      `/mods/edges/${encodeURIComponent(catalogEdgeId)}/content/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`,
    );
    if (!res.ok) {
      showToast(res.message || 'Delete failed', 'error');
      return;
    }
    showToast(res.message || 'Deleted from VPS', 'success');
    closeCatalogSidePanel(type);
    await loadModCatalog(type);
  });
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
