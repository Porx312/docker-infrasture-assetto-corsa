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
function renderLoadingUrlsList(refs, urls) {
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
      <button type="button" class="btn btn-ghost loading-url-remove" data-loading-url-remove aria-label="Remove URL">✕</button>
    </div>
  `,
    )
    .join('');
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
  } = opts;

  const loadingFieldHtml = loadingListMode
    ? `
      <div class="form-group branding-full loading-urls-field">
        <div class="loading-urls-header">
          <label>${loadingLabel} (rotates per join)</label>
          <button type="button" class="btn btn-ghost btn-sm" id="${refs.loadingListAddBtn}">Add image</button>
        </div>
        <p class="loading-urls-note">Content Manager shows one image per connection; a random URL from this list is picked each time.</p>
        <div class="loading-url-list" id="${refs.loadingListContainer}"></div>
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
        <input class="input" type="url" id="${refs.fields.bannerImageUrl}" placeholder="https://...">
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
        updateBrandingPreview(refs);
        onInput?.();
      }
    });

    container?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.matches('[data-loading-url-remove]')) {
        const row = target.closest('[data-loading-url-row]');
        const rows = container.querySelectorAll('[data-loading-url-row]');
        if (row && rows.length > 1) {
          row.remove();
        } else if (row) {
          const input = row.querySelector('[data-loading-url-input]');
          if (input instanceof HTMLInputElement) input.value = '';
        }
        updateBrandingPreview(refs);
        onInput?.();
        return;
      }
    });

    refs.loadingListAddBtn &&
      document.getElementById(refs.loadingListAddBtn)?.addEventListener('click', () => {
        const urls = readLoadingImageUrls(refs.loadingListContainer);
        renderLoadingUrlsList(refs, [...urls, '']);
        const containerEl = document.getElementById(refs.loadingListContainer);
        const lastInput = containerEl?.querySelector('[data-loading-url-row]:last-child [data-loading-url-input]');
        if (lastInput instanceof HTMLInputElement) lastInput.focus();
        updateBrandingPreview(refs);
        onInput?.();
      });
  }
}

/** @param {BrandingFormRefs} refs @param {string} html */
export function setCmPreviewHtml(refs, html) {
  const cmEl = document.getElementById(refs.previews.cm);
  if (cmEl) cmEl.textContent = html;
}
