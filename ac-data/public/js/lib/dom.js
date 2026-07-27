/** @param {string} text */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/** @param {string} text */
export function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** @param {string} message */
export function emptyStateHtml(message) {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/** @param {number} bytes */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

/** @param {string} dateStr */
export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** @param {string} containerId @param {string} url */
export function renderImagePreview(containerId, url) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!url) {
    el.innerHTML = '<span class="branding-preview-empty">No URL</span>';
    return;
  }
  el.innerHTML = `<img src="${escapeAttr(url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'branding-preview-empty',textContent:'Failed to load'}))">`;
}
