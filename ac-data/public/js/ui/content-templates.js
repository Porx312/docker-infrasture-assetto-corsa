import { API_BASE } from '../lib/api.js';
import { escapeAttr, escapeHtml, emptyStateHtml, formatDate, formatSize } from '../lib/dom.js';
import { isCardGridType } from '../config/tabs.js';

/** @param {string} type */
export function variantLabel(type) {
  return type === 'tracks' ? 'Layouts' : 'Skins';
}

/**
 * @param {string} type
 * @param {string} itemName
 * @param {string} variantName
 */
export function previewUrl(type, itemName, variantName) {
  return `${API_BASE}/preview/${type}/${encodeURIComponent(itemName)}/${encodeURIComponent(variantName)}`;
}

/**
 * @param {string} type
 * @param {string} itemName
 * @param {Array<{ name: string }>} variants
 */
export function renderVariantGrid(type, itemName, variants) {
  if (!variants?.length) return '';

  return `
    <div class="variant-grid">
      ${variants
        .map(
          (variant) => `
        <article class="variant-card" title="${escapeAttr(variant.name)}">
          <div class="variant-thumb">
            <img src="${previewUrl(type, itemName, variant.name)}" alt="" loading="lazy" onerror="this.closest('.variant-thumb').classList.add('no-preview'); this.remove();">
          </div>
          <div class="variant-name">${escapeHtml(variant.name)}</div>
        </article>
      `,
        )
        .join('')}
    </div>
  `;
}

/** @param {object} item @param {string} type */
function modCardThumb(item, type) {
  const first = item.variants?.[0];
  if (first) {
    return `<img src="${previewUrl(type, item.name, first.name)}" alt="" loading="lazy" onerror="this.classList.add('hidden'); this.nextElementSibling?.classList.remove('hidden');">
      <span class="mod-card-placeholder hidden">${type === 'tracks' ? 'T' : 'C'}</span>`;
  }
  return `<span class="mod-card-placeholder">${type === 'tracks' ? 'T' : 'C'}</span>`;
}

/** @param {object} item @param {string} type */
export function renderModCard(item, type) {
  const count = item.variants?.length ?? 0;
  const meta =
    count > 0
      ? `${count} ${variantLabel(type).toLowerCase()}`
      : item.isDirectory
        ? 'Folder'
        : formatSize(item.size);

  return `
    <button type="button" class="mod-card" data-open-mod="${type}" data-name="${escapeAttr(item.name)}">
      <div class="mod-card-thumb">${modCardThumb(item, type)}</div>
      <div class="mod-card-name">${escapeHtml(item.name)}</div>
      <div class="mod-card-meta">${meta}</div>
    </button>
  `;
}

/** @param {object} item @param {string} type */
export function renderItemBlock(item, type) {
  return `
    <div class="item-block">
      <div class="item-row">
        <div class="item-info">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-meta">
            ${item.isDirectory ? 'Folder' : formatSize(item.size)} · ${formatDate(item.modified)}
          </div>
        </div>
        <button type="button" class="btn btn-danger btn-icon" data-delete="${type}" data-name="${escapeAttr(item.name)}" title="Delete">✕</button>
      </div>
    </div>
  `;
}

/** @param {string} type @param {number} [count] */
export function skeletonHtml(type, count = 5) {
  if (isCardGridType(type)) {
    return Array.from(
      { length: Math.min(count, 8) },
      () => '<div class="mod-card skeleton-mod-card"><div class="skeleton-row"></div></div>',
    ).join('');
  }
  return Array.from({ length: count }, () => '<div class="skeleton-row"></div>').join('');
}

/**
 * @param {import('../config/tabs.js').TabConfig} tab
 */
export function renderContentPanelHtml(tab) {
  const type = tab.id;
  const cardGrid = isCardGridType(type);

  return `
    <div class="panel" data-type="${type}">
      <div class="panel-header">
        <h2>${tab.label}</h2>
        <div class="panel-search">
          <input type="text" class="input search-input" id="${type}Search" placeholder="Search ${tab.label.toLowerCase()}…">
          ${
            cardGrid
              ? `
          <label class="filter-toggle">
            <input type="checkbox" id="${type}ShowAll">
            <span>All folders</span>
          </label>
          <button type="button" class="btn btn-sm btn-ghost" id="${type}CleanEmpty" title="Delete mods without .acd or .kn5">Clean empty</button>`
              : ''
          }
          <span class="panel-count" id="${type}Filtered"></span>
        </div>
      </div>
      <div class="upload-dropzone" id="${type}Upload">
        <p>Drag & drop files, folders or ZIP archives here</p>
        <p class="upload-hint">${tab.hint}</p>
        <input type="file" id="${type}FileInput" multiple>
        <input type="file" id="${type}FolderInput" webkitdirectory multiple hidden>
        <button type="button" class="btn btn-primary" data-select="${type}">Select files</button>
        <button type="button" class="btn" data-select-folder="${type}">Select folder</button>
        <div class="progress-bar" id="${type}Progress">
          <div class="progress-bar-fill" id="${type}ProgressFill"></div>
        </div>
      </div>
      <div id="${type}List" class="${cardGrid ? 'content-grid' : 'item-list'}"></div>
    </div>
  `;
}
