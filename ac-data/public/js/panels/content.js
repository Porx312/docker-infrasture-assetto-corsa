import { apiDelete, apiGet, apiPostForm } from '../lib/api.js';
import { emptyStateHtml, formatDate, formatSize } from '../lib/dom.js';
import {
  closeModal,
  hideUploadOverlay,
  openModal,
  showConfirm,
  showUploadOverlay,
} from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { filesFromDataTransfer, normalizeUploadFiles, uploadRelativePath } from '../lib/upload-files.js';
import { isCardGridType, getTab } from '../config/tabs.js';
import {
  renderContentPanelHtml,
  renderItemBlock,
  renderModCard,
  skeletonHtml,
  variantLabel,
  renderVariantGrid,
} from '../ui/content-templates.js';

/** @type {Record<string, object[]>} */
const itemsByType = { cars: [], tracks: [], weather: [] };

/** @param {string} type */
export function getItems(type) {
  return itemsByType[type] ?? [];
}

/**
 * @param {string} type
 * @param {HTMLElement} container
 */
export function mountContentPanel(type, container) {
  const tab = getTab(type);
  container.innerHTML = renderContentPanelHtml(tab);
  bindContentPanel(type);
}

/** @param {string} type */
function bindContentPanel(type) {
  document.getElementById(`${type}Search`)?.addEventListener('input', () => filterItems(type));
  document.getElementById(`${type}ShowAll`)?.addEventListener('change', () => filterItems(type));

  const dropzone = document.getElementById(`${type}Upload`);
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', (e) => {
    e.currentTarget.classList.remove('dragover');
  });
  dropzone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) confirmUpload(files, type);
  });

  document.getElementById(`${type}FileInput`)?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const files = normalizeUploadFiles(input.files ?? []);
    if (files.length) confirmUpload(files, type);
    input.value = '';
  });

  document.getElementById(`${type}FolderInput`)?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const files = normalizeUploadFiles(input.files ?? []);
    if (files.length) confirmUpload(files, type);
    input.value = '';
  });

  document.querySelector(`[data-select="${type}"]`)?.addEventListener('click', () => {
    document.getElementById(`${type}FileInput`)?.click();
  });

  document.querySelector(`[data-select-folder="${type}"]`)?.addEventListener('click', () => {
    document.getElementById(`${type}FolderInput`)?.click();
  });

  document.getElementById(`${type}List`)?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete]');
    if (btn) deleteItem(btn.dataset.delete, btn.dataset.name);
  });

  if (isCardGridType(type)) {
    document.getElementById(`${type}CleanEmpty`)?.addEventListener('click', () => {
      void cleanEmptyMods(type);
    });
  }
}

/** @param {object} item @param {string} type @param {string} searchTerm @param {boolean} showAll */
function shouldShowItem(item, type, searchTerm, showAll) {
  const nameMatch = item.name.toLowerCase().includes(searchTerm);
  const variantMatch = (item.variants || []).some((v) => v.name.toLowerCase().includes(searchTerm));
  if (!nameMatch && !variantMatch) return false;
  if (isCardGridType(type) && !showAll) {
    return item.isDirectory && (item.variants?.length ?? 0) > 0;
  }
  return true;
}

/** @param {string} type */
function filterItems(type) {
  const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
  const filteredSpan = document.getElementById(`${type}Filtered`);
  const showAllInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}ShowAll`));
  const searchTerm = searchInput?.value.toLowerCase() ?? '';
  const showAll = showAllInput?.checked ?? type === 'weather';
  const items = itemsByType[type] || [];

  const filtered = items.filter((item) => shouldShowItem(item, type, searchTerm, showAll));
  const visibleLabel = isCardGridType(type)
    ? showAll
      ? `${filtered.length} folders`
      : `${filtered.length} with ${variantLabel(type).toLowerCase()}`
    : searchTerm
      ? `${filtered.length} of ${items.length}`
      : `${items.length} items`;

  if (filteredSpan) filteredSpan.textContent = visibleLabel;
  renderItems(filtered, type, showAll);
}

/**
 * @param {object[]} items
 * @param {string} type
 * @param {boolean} showAll
 */
function renderItems(items, type, showAll) {
  const container = document.getElementById(`${type}List`);
  if (!container) return;

  const useCardGrid = isCardGridType(type);

  if (!items.length) {
    container.innerHTML = emptyStateHtml(
      useCardGrid && !showAll
        ? `No ${variantLabel(type).toLowerCase()} found — enable "All folders" to see everything`
        : 'No items found',
    );
    return;
  }

  if (useCardGrid && !showAll) {
    container.innerHTML = items
      .filter((item) => item.variants?.length)
      .map((item) => renderModCard(item, type))
      .join('');
    return;
  }

  if (useCardGrid) {
    container.innerHTML = items.map((item) => renderModCard(item, type)).join('');
    return;
  }

  container.innerHTML = items.map((item) => renderItemBlock(item, type)).join('');
}

/** @param {string} type */
export async function loadContent(type) {
  const list = document.getElementById(`${type}List`);
  if (list) list.innerHTML = skeletonHtml(type);

  try {
    const { data } = await apiGet(`/content/${type}`);
    if (!data.ok) {
      if (list) list.innerHTML = emptyStateHtml(`Error: ${data.message || 'Failed to load'}`);
      return;
    }

    itemsByType[type] = data.items;
    const filteredSpan = document.getElementById(`${type}Filtered`);
    const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById(`${type}Search`));
    if (filteredSpan) filteredSpan.textContent = `${data.items.length} items`;
    if (searchInput) searchInput.value = '';
    filterItems(type);
  } catch {
    if (list) list.innerHTML = emptyStateHtml('Connection error');
  }
}

/**
 * @param {string} type
 * @param {string} name
 */
export function openContentDetail(type, name) {
  const item = itemsByType[type]?.find((entry) => entry.name === name);
  if (!item) return;

  document.getElementById('modTitle').textContent = item.name;
  document.getElementById('modMeta').textContent = `${item.isDirectory ? 'Folder' : formatSize(item.size)} · Modified ${formatDate(item.modified)}`;

  const variantsEl = document.getElementById('modVariants');
  if (item.variants?.length && variantsEl) {
    variantsEl.innerHTML = `
      <p class="modal-mod-section">${variantLabel(type)} (${item.variants.length})</p>
      ${renderVariantGrid(type, item.name, item.variants)}
    `;
  } else if (variantsEl) {
    variantsEl.innerHTML = emptyStateHtml(`No ${variantLabel(type).toLowerCase()} in this mod`);
  }

  const deleteBtn = document.getElementById('modDeleteBtn');
  if (deleteBtn) {
    deleteBtn.dataset.delete = type;
    deleteBtn.dataset.name = name;
  }

  openModal('modModal');
}

export function closeContentDetail() {
  closeModal('modModal');
}

/** @param {string} type @param {string} name */
async function deleteItem(type, name) {
  const confirmed = await showConfirm('Delete item', `Delete "${name}"? This cannot be undone.`);
  if (!confirmed) return;

  try {
    const { data } = await apiDelete(`/content/${type}/${encodeURIComponent(name)}`);
    if (data.ok) {
      showToast(`Deleted ${name}`);
      closeContentDetail();
      loadContent(type);
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  }
}

/** @param {File[]} files @param {string} type */
async function confirmUpload(files, type) {
  const summary =
    files.length === 1
      ? uploadRelativePath(files[0])
      : `${files.length} files:\n${files.slice(0, 8).map((f) => `· ${uploadRelativePath(f)}`).join('\n')}${files.length > 8 ? `\n… +${files.length - 8} more` : ''}`;

  if (await showConfirm('Upload files', summary, 'Upload')) {
    uploadFiles(files, type);
  }
}

/** @param {File[]} files @param {string} type */
async function uploadFiles(files, type) {
  showUploadOverlay(`Uploading ${files.length} file(s)…`);

  const progressBar = document.getElementById(`${type}Progress`);
  const progressFill = document.getElementById(`${type}ProgressFill`);
  progressBar?.classList.add('show');
  if (progressFill) progressFill.style.width = '0%';

  let successCount = 0;
  /** @type {string[]} */
  const errorMessages = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = uploadRelativePath(file);
    const formData = new FormData();
    formData.append('file', file, relPath);

    try {
      const { res, data } = await apiPostForm(`/upload/${type}`, formData);
      if (res.ok && data.ok !== false) {
        successCount++;
        if (data.extracted?.length > 1) {
          showToast(`Extracted ${data.extracted.length} files from ${file.name}`);
        }
      } else {
        errorMessages.push(`${relPath}: ${data.message || data.error || `HTTP ${res.status}`}`);
      }
    } catch (err) {
      const hint = err instanceof Error ? err.message : 'network error';
      errorMessages.push(`${uploadRelativePath(file)}: Connection error (${hint})`);
    }

    if (progressFill) progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
  }

  setTimeout(() => {
    progressBar?.classList.remove('show');
    hideUploadOverlay();

    if (successCount > 0) {
      showToast(
        errorMessages.length
          ? `Uploaded ${successCount} file(s), ${errorMessages.length} errors`
          : `Uploaded ${successCount} file(s) successfully`,
        errorMessages.length ? 'error' : 'success',
      );
    } else if (errorMessages.length) {
      showToast(errorMessages.join('\n'), 'error');
    }

    loadContent(type);
  }, 500);
}

/** Called from dashboard delete button in mod modal */
export function handleModDelete(type, name) {
  deleteItem(type, name);
}

/** @param {string} type */
async function cleanEmptyMods(type) {
  try {
    const preview = await apiDelete(`/content/empty?type=${encodeURIComponent(type)}&dryRun=true`);
    const targets = preview.data?.deleted ?? [];
    if (!targets.length) {
      showToast('No empty mods found');
      return;
    }

    const list = targets.slice(0, 8).join(', ') + (targets.length > 8 ? ` … +${targets.length - 8} more` : '');
    const confirmed = await showConfirm(
      'Clean empty mods',
      `Delete ${targets.length} mod(s) without .acd or .kn5?\n\n${list}`,
      'Delete',
    );
    if (!confirmed) return;

    const { data } = await apiDelete(`/content/empty?type=${encodeURIComponent(type)}`);
    if (data.ok) {
      showToast(`Removed ${data.deleted?.length ?? 0} empty mod(s)`);
      loadContent(type);
    } else {
      showToast(data.message || 'Cleanup failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  }
}
