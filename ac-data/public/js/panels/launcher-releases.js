import { apiDelete, apiGet, apiPostFormWithProgress } from '../lib/api.js';
import { formatSize } from '../lib/dom.js';
import { showConfirm } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { normalizeUploadFiles } from '../lib/upload-files.js';
import {
  renderLauncherReleasesPanelHtml,
  renderLauncherReleasesRowsHtml,
} from '../ui/launcher-releases-templates.js';

/**
 * @param {HTMLElement} container
 */
export function mountLauncherReleasesPanel(container) {
  container.innerHTML = renderLauncherReleasesPanelHtml();

  document.getElementById('launcherReleaseSelectBtn')?.addEventListener('click', () => {
    document.getElementById('launcherReleaseFileInput')?.click();
  });

  document.getElementById('launcherReleaseFileInput')?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const files = normalizeUploadFiles(input.files ?? []);
    if (files.length) void uploadLauncherRelease(files[0]);
    input.value = '';
  });

  const dropzone = document.getElementById('launcherReleaseUpload');
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
    if (file) void uploadLauncherRelease(file);
  });

  document.getElementById('launcherReleasesBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.launcher-release-delete');
    if (!btn) return;
    void deleteLauncherRelease(btn.dataset.filename);
  });
}

export async function loadLauncherReleasesPanel() {
  const tbody = document.getElementById('launcherReleasesBody');
  const empty = document.getElementById('launcherReleasesEmpty');
  const countEl = document.getElementById('launcherReleaseCount');
  if (!tbody || !empty) return;

  try {
    const { res, data } = await apiGet('/launcher/releases');
    if (!data.ok) {
      const fallback = res.status ? `Failed to load launcher releases (${res.status})` : 'Failed to load launcher releases';
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
    tbody.innerHTML = renderLauncherReleasesRowsHtml(releases, data.latest ?? null);
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
function setLauncherUploadBusy(busy) {
  const dropzone = document.getElementById('launcherReleaseUpload');
  const selectBtn = document.getElementById('launcherReleaseSelectBtn');
  dropzone?.classList.toggle('is-uploading', busy);
  dropzone?.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (selectBtn instanceof HTMLButtonElement) {
    selectBtn.disabled = busy;
  }
}

/** @param {File} file */
async function uploadLauncherRelease(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast('Only .zip files are allowed', 'error');
    return;
  }

  const progress = document.getElementById('launcherReleaseProgress');
  const fill = document.getElementById('launcherReleaseProgressFill');
  const label = document.getElementById('launcherReleaseProgressLabel');

  setLauncherUploadBusy(true);
  progress?.classList.add('show');
  if (fill) fill.style.width = '0%';
  label?.classList.add('hidden');
  if (label) label.textContent = '';

  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const { res, data } = await apiPostFormWithProgress('/launcher/releases', form, (loaded, total) => {
      const pct = total > 0 ? (loaded / total) * 100 : 0;
      if (fill) fill.style.width = `${pct}%`;
      updateUploadProgressLabel(label, loaded, total);
    });
    if (fill) fill.style.width = '100%';
    if (data.ok) {
      showToast(data.message || 'Launcher release uploaded');
      await loadLauncherReleasesPanel();
    } else {
      const fallback = res.status ? `Upload failed (${res.status})` : 'Upload failed';
      showToast(data.message || fallback, 'error');
    }
  } catch {
    showToast('Upload failed — connection error', 'error');
  } finally {
    setLauncherUploadBusy(false);
    window.setTimeout(() => {
      progress?.classList.remove('show');
      label?.classList.add('hidden');
      if (fill) fill.style.width = '0%';
    }, 400);
  }
}

/** @param {string} filename */
async function deleteLauncherRelease(filename) {
  if (!filename) return;
  const ok = await showConfirm(`Delete launcher release "${filename}"?`);
  if (!ok) return;

  try {
    const { data } = await apiDelete(`/launcher/releases/${encodeURIComponent(filename)}`);
    if (data.ok) {
      showToast(data.message || 'Deleted');
      await loadLauncherReleasesPanel();
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  }
}
