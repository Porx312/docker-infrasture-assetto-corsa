import { escapeAttr, renderImagePreview } from './dom.js';

/**
 * @typedef {Object} BrandingValues
 * @property {string} description
 * @property {string} webLink
 * @property {string} cmDescriptionBody
 * @property {string} bannerImageUrl
 * @property {string} loadingImageUrl
 * @property {string[]} [loadingImageUrls]
 */

/**
 * @typedef {Object} BrandingFormRefs
 * @property {Record<string, string>} fields
 * @property {{ banner: string; loading: string; cm: string }} previews
 * @property {boolean} [loadingListMode]
 * @property {string|null} [loadingListContainer]
 * @property {string|null} [loadingListAddBtn]
 * @property {string|null} [loadingListManageBtn]
 * @property {string|null} [loadingListSummary]
 */

/** @param {string} prefix e.g. "br" or "sc" @param {{ loadingListMode?: boolean }} [opts] */
export function brandingRefs(prefix, opts = {}) {
  const loadingListMode = opts.loadingListMode ?? false;
  return {
    fields: {
      description: `${prefix}Description`,
      webLink: `${prefix}WebLink`,
      cmDescriptionBody: `${prefix}CmBody`,
      bannerImageUrl: `${prefix}BannerUrl`,
      loadingImageUrl: `${prefix}LoadingUrl`,
    },
    previews: {
      banner: `${prefix}BannerPreview`,
      loading: `${prefix}LoadingPreview`,
      cm: `${prefix}CmPreview`,
    },
    loadingListMode,
    loadingListContainer: loadingListMode ? `${prefix}LoadingUrlsList` : null,
    loadingListAddBtn: loadingListMode ? `${prefix}LoadingUrlAdd` : null,
    loadingListManageBtn: loadingListMode ? `${prefix}LoadingManageBtn` : null,
    loadingListSummary: loadingListMode ? `${prefix}LoadingSummary` : null,
  };
}

/**
 * @param {string|null|undefined} containerId
 * @returns {string[]}
 */
function readLoadingImageUrls(containerId) {
  if (!containerId) return [];
  const container = document.getElementById(containerId);
  if (!container) return [];

  /** @type {string[]} */
  const urls = [];
  for (const el of container.querySelectorAll('[data-loading-url-input]')) {
    if (el instanceof HTMLInputElement) {
      const trimmed = el.value.trim();
      if (trimmed) urls.push(trimmed);
    }
  }
  return urls;
}

/** @returns {string|null} Error message for the first invalid URL, if any. */
export function validateLoadingImageUrls(urls) {
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]?.trim();
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Loading screen #${index + 1}: use http(s) URL`;
      }
    } catch {
      return `Loading screen #${index + 1}: invalid URL`;
    }
  }
  return null;
}

/** Ensure the global loading URL list has at least one editable row. */
export function seedLoadingUrlsList(refs) {
  if (!refs.loadingListMode || !refs.loadingListContainer) return;
  const container = document.getElementById(refs.loadingListContainer);
  if (!container) return;
  if (container.querySelector('[data-loading-url-input]')) return;
  renderLoadingUrlsList(refs, ['']);
}

/**
 * @param {BrandingFormRefs} refs
 * @param {string[]} urls
 */
export function renderLoadingUrlsList(refs, urls) {
  const containerId = refs.loadingListContainer;
  if (!containerId) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  const list = urls.length > 0 ? urls : [''];
  container.innerHTML = list
    .map(
      (url, index) => `
    <div class="loading-url-row" data-loading-url-row>
      <input
        class="input loading-url-input"
        type="text"
        inputmode="url"
        autocomplete="off"
        data-loading-url-input
        value="${escapeAttr(url)}"
        placeholder="https://..."
        aria-label="Loading screen URL ${index + 1}"
      >
    </div>
  `,
    )
    .join('');

  updateLoadingScreensSummary(refs);
}

/** @param {BrandingFormRefs} refs */
export function updateLoadingScreensSummary(refs) {
  if (!refs.loadingListSummary) return;
  const el = document.getElementById(refs.loadingListSummary);
  if (!el) return;
  const urls = readLoadingImageUrls(refs.loadingListContainer).filter(Boolean);
  const emptyHint = el.dataset.emptyHint || 'No loading screens yet — open Manage to upload or pick images';
  el.textContent =
    urls.length === 0
      ? emptyHint
      : urls.length === 1
        ? '1 loading screen configured (random per CM join)'
        : `${urls.length} loading screens configured (random per CM join)`;
}

/**
 * @param {BrandingFormRefs} refs
 * @param {string[]} urls
 */
function renderLoadingUrlsPreview(refs, urls) {
  const el = document.getElementById(refs.previews.loading);
  if (!el) return;

  const valid = urls.filter(Boolean);
  if (valid.length === 0) {
    el.innerHTML = '<span class="branding-preview-empty">No URLs</span>';
    return;
  }

  el.innerHTML = `
    <div class="loading-preview-grid">
      ${valid
        .map(
          (url) => `
        <div class="loading-preview-thumb">
          <img src="${escapeAttr(url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'branding-preview-empty',textContent:'Failed'}))">
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

/** @param {BrandingFormRefs} refs */
export function readBranding(refs) {
  /** @type {BrandingValues} */
  const values = {
    description: '',
    webLink: '',
    cmDescriptionBody: '',
    bannerImageUrl: '',
    loadingImageUrl: '',
  };

  for (const [key, id] of Object.entries(refs.fields)) {
    if (key === 'loadingImageUrl' && refs.loadingListMode) continue;
    const el = document.getElementById(id);
    values[key] = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
  }

  if (refs.loadingListMode) {
    values.loadingImageUrls = readLoadingImageUrls(refs.loadingListContainer);
    values.loadingImageUrl = values.loadingImageUrls[0] ?? '';
  }

  return values;
}

/**
 * @param {BrandingFormRefs} refs
 * @param {Partial<BrandingValues>} data
 */
export function fillBranding(refs, data) {
  for (const [key, id] of Object.entries(refs.fields)) {
    if (key === 'loadingImageUrl' && refs.loadingListMode) continue;
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = data[key] ?? '';
    }
  }

  if (refs.loadingListMode) {
    const fromArray = Array.isArray(data.loadingImageUrls)
      ? data.loadingImageUrls.map((url) => String(url).trim()).filter(Boolean)
      : [];
    const legacy = String(data.loadingImageUrl ?? '').trim();
    const urls = fromArray.length > 0 ? fromArray : legacy ? [legacy] : [''];
    renderLoadingUrlsList(refs, urls);
    void bindBrandingImageUploads(refs);
  }

  updateBrandingPreview(refs);
}

/** @param {Partial<BrandingValues>} form */
export function buildCmPreview(form) {
  const body = form.cmDescriptionBody || form.description || '';
  const firstLoading =
    form.loadingImageUrls?.find(Boolean) || form.loadingImageUrl || '';
  const banner = form.bannerImageUrl || firstLoading || '';
  if (banner) {
    return `[img=${banner}]ProjectD[/img]\n\n${body}`;
  }
  return body;
}

/** @param {BrandingFormRefs} refs */
export function updateBrandingPreview(refs) {
  const values = readBranding(refs);
  renderImagePreview(refs.previews.banner, values.bannerImageUrl);

  if (refs.loadingListMode) {
    renderLoadingUrlsPreview(refs, values.loadingImageUrls ?? []);
  } else {
    renderImagePreview(refs.previews.loading, values.loadingImageUrl);
  }

  const cmEl = document.getElementById(refs.previews.cm);
  if (cmEl) cmEl.textContent = buildCmPreview(values);
}

/**
 * @param {BrandingFormRefs} refs
 * @param {{
 *   descriptionRows?: number;
 *   cmBodyRows?: number;
 *   bannerLabel?: string;
 *   loadingLabel?: string;
 *   previewClass?: string;
 *   loadingListMode?: boolean;
 *   hideLoadingManage?: boolean;
 * }} [opts]
 */
export function renderBrandingFieldsHtml(refs, opts = {}) {
  const {
    descriptionRows = 2,
    cmBodyRows = 4,
    bannerLabel = 'Banner image',
    loadingLabel = 'Loading screen',
    previewClass = '',
    loadingListMode = false,
    hideLoadingManage = false,
  } = opts;

  const manageBtnHtml =
    loadingListMode && !hideLoadingManage && refs.loadingListManageBtn
      ? `<button type="button" class="btn btn-ghost btn-sm" id="${refs.loadingListManageBtn}">Manage loading screens</button>`
      : '';

  const loadingEmptyHint = hideLoadingManage
    ? 'No loading screens yet — use Loading screens in the toolbar'
    : 'No loading screens yet — open Manage to upload or pick images';

  const loadingFieldHtml = loadingListMode
    ? `
      <div class="form-group branding-full loading-urls-field">
        <div class="loading-urls-header">
          <label>${loadingLabel}</label>
          ${manageBtnHtml}
        </div>
        <p class="loading-urls-note" id="${refs.loadingListSummary}" data-empty-hint="${escapeAttr(loadingEmptyHint)}">${loadingEmptyHint}</p>
        <div class="loading-url-list hidden" id="${refs.loadingListContainer}" aria-hidden="true"></div>
      </div>
    `
    : `
      <div class="form-group">
        <label for="${refs.fields.loadingImageUrl}">${loadingLabel}</label>
        <input class="input" type="url" id="${refs.fields.loadingImageUrl}" placeholder="https://...">
      </div>
    `;

  return `
    <div class="branding-grid">
      <div class="form-group">
        <label for="${refs.fields.description}">Lobby description</label>
        <textarea class="input branding-textarea" id="${refs.fields.description}" rows="${descriptionRows}" placeholder="Plain text shown in AC server list"></textarea>
      </div>
      <div class="form-group">
        <label for="${refs.fields.webLink}">Website URL</label>
        <input class="input" type="url" id="${refs.fields.webLink}" placeholder="https://projectd.space">
      </div>
      <div class="form-group branding-full">
        <label for="${refs.fields.cmDescriptionBody}">CM description body</label>
        <textarea class="input branding-textarea" id="${refs.fields.cmDescriptionBody}" rows="${cmBodyRows}" placeholder="BBCode: [url=https://...]link[/url]"></textarea>
      </div>
      <div class="form-group">
        <label for="${refs.fields.bannerImageUrl}">${bannerLabel}</label>
        <div class="branding-url-with-upload">
          <input class="input" type="url" id="${refs.fields.bannerImageUrl}" placeholder="https://...">
          <button type="button" class="btn btn-ghost btn-sm branding-upload-btn" data-banner-upload>Upload</button>
          <input type="file" class="hidden branding-file-input" data-banner-file accept="image/jpeg,image/png,image/webp,image/gif" />
        </div>
      </div>
      ${loadingFieldHtml}
    </div>
    <div class="branding-preview ${previewClass}">
      <div class="branding-preview-block">
        <span class="branding-preview-label">Banner preview</span>
        <div class="branding-preview-img" id="${refs.previews.banner}"></div>
      </div>
      <div class="branding-preview-block">
        <span class="branding-preview-label">${loadingListMode ? 'Loading previews' : 'Loading preview'}</span>
        <div class="branding-preview-img ${loadingListMode ? 'loading-preview-multi' : ''}" id="${refs.previews.loading}"></div>
      </div>
      <div class="branding-preview-block branding-full">
        <span class="branding-preview-label">CM description preview</span>
        <pre class="branding-preview-text" id="${refs.previews.cm}"></pre>
      </div>
    </div>
  `;
}

/**
 * Upload image via hub → data/branding; returns public URL for CM.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function uploadBrandingImageFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/admin/branding/upload-image', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.url) {
    throw new Error(data.message || `Upload failed (${res.status})`);
  }
  return String(data.url);
}

let brandingUploadAvailable = null;

/** @returns {Promise<boolean>} */
export async function isBrandingUploadAvailable() {
  if (brandingUploadAvailable !== null) return brandingUploadAvailable;
  try {
    const res = await fetch('/admin/branding/upload-status', { credentials: 'same-origin' });
    const data = await res.json();
    brandingUploadAvailable = Boolean(data.ok && data.uploadConfigured);
  } catch {
    brandingUploadAvailable = false;
  }
  return brandingUploadAvailable;
}

/**
 * Wire Upload buttons (banner + loading rows). Hidden when public hub URL is not set.
 * @param {BrandingFormRefs} refs
 * @param {() => void} [onUploaded]
 */
export async function bindBrandingImageUploads(refs, onUploaded) {
  const enabled = await isBrandingUploadAvailable();
  const root =
    document.getElementById(refs.fields.bannerImageUrl)?.closest('form') ||
    document.getElementById(refs.fields.bannerImageUrl)?.closest('.modal-server-body') ||
    document;

  root.querySelectorAll('[data-banner-upload], [data-loading-url-upload]').forEach((btn) => {
    if (btn instanceof HTMLElement) {
      btn.classList.toggle('hidden', !enabled);
      btn.title = enabled
        ? 'Upload to hub data/branding'
        : 'Set HUD_PUBLIC_BASE_URL on hub to enable uploads';
    }
  });
  if (!enabled) return;

  const bannerBtn = root.querySelector('[data-banner-upload]');
  const bannerFile = root.querySelector('[data-banner-file]');
  if (bannerBtn instanceof HTMLElement && bannerFile instanceof HTMLInputElement) {
    bannerBtn.onclick = () => bannerFile.click();
    bannerFile.onchange = async () => {
      const file = bannerFile.files?.[0];
      bannerFile.value = '';
      if (!file) return;
      try {
        bannerBtn.setAttribute('disabled', 'true');
        const url = await uploadBrandingImageFile(file);
        const input = document.getElementById(refs.fields.bannerImageUrl);
        if (input instanceof HTMLInputElement) {
          input.value = url;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        onUploaded?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        window.alert(message);
      } finally {
        bannerBtn.removeAttribute('disabled');
      }
    };
  }

  if (refs.loadingListMode && refs.loadingListContainer) {
    const container = document.getElementById(refs.loadingListContainer);
    container?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('[data-loading-url-upload]')) return;
      const row = target.closest('[data-loading-url-row]');
      const fileInput = row?.querySelector('[data-loading-url-file]');
      if (fileInput instanceof HTMLInputElement) fileInput.click();
    });
    container?.addEventListener('change', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches('[data-loading-url-file]')) return;
      const file = target.files?.[0];
      target.value = '';
      if (!file) return;
      const row = target.closest('[data-loading-url-row]');
      const urlInput = row?.querySelector('[data-loading-url-input]');
      const uploadBtn = row?.querySelector('[data-loading-url-upload]');
      try {
        uploadBtn?.setAttribute('disabled', 'true');
        const url = await uploadBrandingImageFile(file);
        if (urlInput instanceof HTMLInputElement) {
          urlInput.value = url;
          urlInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        onUploaded?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        window.alert(message);
      } finally {
        uploadBtn?.removeAttribute('disabled');
      }
    });
  }
}

/**
 * @param {BrandingFormRefs} refs
 * @param {() => void} [onInput]
 */
export function bindBrandingPreview(refs, onInput) {
  for (const id of Object.values(refs.fields)) {
    if (refs.loadingListMode && id === refs.fields.loadingImageUrl) continue;
    document.getElementById(id)?.addEventListener('input', () => {
      updateBrandingPreview(refs);
      onInput?.();
    });
  }

  if (refs.loadingListMode && refs.loadingListContainer) {
    const container = document.getElementById(refs.loadingListContainer);
    container?.addEventListener('input', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches('[data-loading-url-input]')) {
        updateLoadingScreensSummary(refs);
        updateBrandingPreview(refs);
        onInput?.();
      }
    });
  }

  void bindBrandingImageUploads(refs, onInput);
}

/** @param {BrandingFormRefs} refs */
export function getLoadingImageUrls(refs) {
  return readLoadingImageUrls(refs.loadingListContainer).filter(Boolean);
}

/**
 * @param {BrandingFormRefs} refs
 * @param {string[]} urls
 */
export function setLoadingImageUrls(refs, urls) {
  renderLoadingUrlsList(refs, urls.length ? urls : ['']);
  updateBrandingPreview(refs);
}

/** @param {BrandingFormRefs} refs @param {string} html */
export function setCmPreviewHtml(refs, html) {
  const cmEl = document.getElementById(refs.previews.cm);
  if (cmEl) cmEl.textContent = html;
}
