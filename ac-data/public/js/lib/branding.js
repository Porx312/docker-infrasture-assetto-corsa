import { renderImagePreview } from './dom.js';

/**
 * @typedef {Object} BrandingValues
 * @property {string} description
 * @property {string} webLink
 * @property {string} cmDescriptionBody
 * @property {string} bannerImageUrl
 * @property {string} loadingImageUrl
 */

/**
 * @typedef {Object} BrandingFormRefs
 * @property {Record<keyof BrandingValues, string>} fields
 * @property {{ banner: string; loading: string; cm: string }} previews
 */

/** @param {string} prefix e.g. "br" or "sc" */
export function brandingRefs(prefix) {
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
  };
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
    const el = document.getElementById(id);
    values[key] = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
  }

  return values;
}

/**
 * @param {BrandingFormRefs} refs
 * @param {Partial<BrandingValues>} data
 */
export function fillBranding(refs, data) {
  for (const [key, id] of Object.entries(refs.fields)) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = data[key] ?? '';
    }
  }
  updateBrandingPreview(refs);
}

/** @param {Partial<BrandingValues>} form */
export function buildCmPreview(form) {
  const body = form.cmDescriptionBody || form.description || '';
  const banner = form.bannerImageUrl || form.loadingImageUrl || '';
  if (banner) {
    return `[img=${banner}]ProjectD[/img]\n\n${body}`;
  }
  return body;
}

/** @param {BrandingFormRefs} refs */
export function updateBrandingPreview(refs) {
  const values = readBranding(refs);
  renderImagePreview(refs.previews.banner, values.bannerImageUrl);
  renderImagePreview(refs.previews.loading, values.loadingImageUrl);
  const cmEl = document.getElementById(refs.previews.cm);
  if (cmEl) cmEl.textContent = buildCmPreview(values);
}

/**
 * @param {BrandingFormRefs} refs
 * @param {{ descriptionRows?: number; cmBodyRows?: number; bannerLabel?: string; loadingLabel?: string; previewClass?: string }} [opts]
 */
export function renderBrandingFieldsHtml(refs, opts = {}) {
  const {
    descriptionRows = 2,
    cmBodyRows = 4,
    bannerLabel = 'Banner image',
    loadingLabel = 'Loading screen',
    previewClass = '',
  } = opts;

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
      <div class="form-group">
        <label for="${refs.fields.loadingImageUrl}">${loadingLabel}</label>
        <input class="input" type="url" id="${refs.fields.loadingImageUrl}" placeholder="https://...">
      </div>
    </div>
    <div class="branding-preview ${previewClass}">
      <div class="branding-preview-block">
        <span class="branding-preview-label">Banner preview</span>
        <div class="branding-preview-img" id="${refs.previews.banner}"></div>
      </div>
      <div class="branding-preview-block">
        <span class="branding-preview-label">Loading preview</span>
        <div class="branding-preview-img" id="${refs.previews.loading}"></div>
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
    document.getElementById(id)?.addEventListener('input', () => {
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
