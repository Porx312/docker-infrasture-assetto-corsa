import { apiDelete, apiGet, apiPostForm } from '../lib/api.js';
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

/** @param {File} file */
async function uploadHudRelease(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showToast('Only .zip files are allowed', 'error');
    return;
  }

  const progress = document.getElementById('hudReleaseProgress');
  const fill = document.getElementById('hudReleaseProgressFill');
  progress?.classList.remove('hidden');
  if (fill) fill.style.width = '30%';

  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const { res, data } = await apiPostForm('/hud/releases', form);
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
    window.setTimeout(() => {
      progress?.classList.add('hidden');
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
