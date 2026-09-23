import { apiDelete, apiGet, apiPostFormWithProgress } from '../lib/api.js';
import { formatSize } from '../lib/dom.js';
import { showConfirm } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { normalizeUploadFiles } from '../lib/upload-files.js';
import {
  renderHudReleasesPanelHtml,
  renderHudReleasesRowsHtml,
} from '../ui/hud-releases-templates.js';

/**
 * @param {HTMLElement} container
 */
export function mountHudReleasesPanel(container) {
  container.innerHTML = renderHudReleasesPanelHtml();

  document.getElementById('hudReleaseSelectBtn')?.addEventListener('click', () => {
    document.getElementById('hudReleaseFileInput')?.click();
  });

  document.getElementById('hudReleaseFileInput')?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const files = normalizeUploadFiles(input.files ?? []);
    if (files.length) void uploadHudRelease(files[0]);
    input.value = '';
  });

  const dropzone = document.getElementById('hudReleaseUpload');
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
    if (file) void uploadHudRelease(file);
  });

  document.getElementById('hudReleasesBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hud-release-delete');
    if (!btn) return;
    void deleteHudRelease(btn.dataset.filename);
  });
}

export async function loadHudReleasesPanel() {
  const tbody = document.getElementById('hudReleasesBody');
  const empty = document.getElementById('hudReleasesEmpty');
  const countEl = document.getElementById('hudReleaseCount');
  if (!tbody || !empty) return;

  try {
    const { res, data } = await apiGet('/hud/releases');
    if (!data.ok) {
      const fallback = res.status ? `Failed to load HUD releases (${res.status})` : 'Failed to load HUD releases';
      showToast(data.message || fallback, 'error');
      return;
    }

    const releases = data.releases ?? [];
    if (countEl) countEl.textContent = `${releases.length} release${releases.length === 1 ? '' : 's'}`;

    if (!releases.length) {
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = renderHudReleasesRowsHtml(releases, data.latest ?? null);
  } catch {
    showToast('Connection error', 'error');
  }
}

/**
 * @param {HTMLElement | null} labelEl
 * @param {number} loaded
 * @param {number} total
 */
function updateUploadProgressLabel(labelEl, loaded, total) {
  if (!labelEl) return;
  labelEl.classList.remove('hidden');
  if (total > 0) {
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    labelEl.textContent = `Uploading… ${formatSize(loaded)} / ${formatSize(total)} (${pct}%)`;
    return;
  }
  labelEl.textContent = `Uploading… ${formatSize(loaded)}`;
}

/**
 * @param {boolean} busy
 */
function setHudUploadBusy(busy) {
  const dropzone = document.getElementById('hudReleaseUpload');
  const selectBtn = document.getElementById('hudReleaseSelectBtn');
  dropzone?.classList.toggle('is-uploading', busy);
  dropzone?.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (selectBtn instanceof HTMLButtonElement) {
    selectBtn.disabled = busy;
  }
}

/** @param {File} file */
async function uploadHudRelease(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast('Only .zip files are allowed', 'error');
    return;
  }

  const progress = document.getElementById('hudReleaseProgress');
  const fill = document.getElementById('hudReleaseProgressFill');
  const label = document.getElementById('hudReleaseProgressLabel');

  setHudUploadBusy(true);
  progress?.classList.add('show');
  if (fill) fill.style.width = '0%';
  label?.classList.add('hidden');
  if (label) label.textContent = '';

  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const { res, data } = await apiPostFormWithProgress('/hud/releases', form, (loaded, total) => {
      const pct = total > 0 ? (loaded / total) * 100 : 0;
      if (fill) fill.style.width = `${pct}%`;
      updateUploadProgressLabel(label, loaded, total);
    });
    if (fill) fill.style.width = '100%';
    if (data.ok) {
      showToast(data.message || 'HUD release uploaded');
      await loadHudReleasesPanel();
    } else {
      const fallback = res.status ? `Upload failed (${res.status})` : 'Upload failed';
      showToast(data.message || fallback, 'error');
    }
  } catch {
    showToast('Upload failed — connection error', 'error');
  } finally {
    setHudUploadBusy(false);
    window.setTimeout(() => {
      progress?.classList.remove('show');
      label?.classList.add('hidden');
      if (fill) fill.style.width = '0%';
    }, 400);
  }
}

/** @param {string} filename */
async function deleteHudRelease(filename) {
  if (!filename) return;
  const ok = await showConfirm(`Delete HUD release "${filename}"?`);
  if (!ok) return;

  try {
    const { data } = await apiDelete(`/hud/releases/${encodeURIComponent(filename)}`);
    if (data.ok) {
      showToast(data.message || 'Deleted');
      await loadHudReleasesPanel();
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  }
}
