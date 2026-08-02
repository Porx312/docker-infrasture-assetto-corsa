import { apiGet, apiPut } from '../lib/api.js';
import {
  bindBrandingPreview,
  brandingRefs,
  fillBranding,
  readBranding,
  setCmPreviewHtml,
  seedLoadingUrlsList,
} from '../lib/branding.js';
import { closeModal, openModal } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import {
  GLOBAL_BRANDING_REFS,
  renderServerChipsHtml,
  renderServerChipsSkeleton,
  renderServersPanelHtml,
} from '../ui/servers-templates.js';

/** @type {Array<{ name: string; displayName?: string; wrapperPort?: number | null }>} */
let serverList = [];
let activeServerName = null;
/** Bumps when branding is saved so in-flight GET /branding cannot overwrite the form. */
let brandingLoadSeq = 0;

const SERVER_BRANDING_REFS = brandingRefs('sc');

/**
 * @param {HTMLElement} container
 */
export function mountServersPanel(container) {
  container.innerHTML = renderServersPanelHtml();

  seedLoadingUrlsList(GLOBAL_BRANDING_REFS);
  bindBrandingPreview(GLOBAL_BRANDING_REFS);
  document.getElementById('brandingForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveGlobalBranding();
  });
}

/** @param {Array<{ name: string; displayName?: string; wrapperPort?: number | null }>} servers */
function renderChips(servers) {
  serverList = servers ?? [];
  const el = document.getElementById('serverChipList');
  if (el) el.innerHTML = renderServerChipsHtml(serverList);
}

export async function loadServersPanel() {
  const countEl = document.getElementById('serversCount');
  const chipEl = document.getElementById('serverChipList');
  if (countEl) countEl.textContent = 'Loading…';
  if (chipEl) chipEl.innerHTML = renderServerChipsSkeleton(4);

  const seq = ++brandingLoadSeq;

  try {
    const { data } = await apiGet('/branding');
    if (seq !== brandingLoadSeq) return;

    if (!data.ok) {
      showToast(data.message || 'Failed to load branding', 'error');
      return;
    }

    fillBranding(GLOBAL_BRANDING_REFS, data.branding);
    renderChips(data.servers);
    if (countEl) countEl.textContent = `${data.serverCount} servers`;
  } catch {
    if (seq !== brandingLoadSeq) return;
    showToast('Connection error', 'error');
    if (countEl) countEl.textContent = '';
  }
}

async function saveGlobalBranding() {
  const btn = document.getElementById('brSaveBtn');
  if (!(btn instanceof HTMLButtonElement)) return;

  const payload = readBranding(GLOBAL_BRANDING_REFS);
  const saveSeq = ++brandingLoadSeq;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { data } = await apiPut('/branding', payload);
    if (saveSeq !== brandingLoadSeq) return;

    if (data.ok) {
      showToast(data.message || 'Branding saved');
      fillBranding(GLOBAL_BRANDING_REFS, data.branding ?? payload);
      brandingLoadSeq += 1;
      renderChips(data.servers);
      const countEl = document.getElementById('serversCount');
      if (countEl) countEl.textContent = `${data.servers?.length ?? 0} servers`;
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch {
    if (saveSeq === brandingLoadSeq) {
      showToast('Connection error', 'error');
    }
  } finally {
    if (saveSeq === brandingLoadSeq) {
      btn.disabled = false;
      btn.textContent = 'Save & apply to all servers';
    }
  }
}

/** @param {string} serverName */
export async function openServerConfig(serverName) {
  activeServerName = serverName;
  const chip = serverList.find((s) => s.name === serverName);

  document.getElementById('serverConfigTitle').textContent = chip?.displayName || serverName;
  document.getElementById('serverConfigMeta').textContent = `${serverName} · loading…`;
  openModal('serverConfigModal');

  const saveBtn = document.getElementById('serverConfigSaveBtn');
  if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;

  try {
    const { data } = await apiGet(`/servers/${encodeURIComponent(serverName)}/config`);
    if (!data.ok) {
      showToast(data.message || 'Failed to load config', 'error');
      closeServerConfig();
      return;
    }

    const { config } = data;
    const ports = [
      config.udpPort != null ? `UDP ${config.udpPort}` : null,
      config.httpPort != null ? `HTTP ${config.httpPort}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    document.getElementById('serverConfigMeta').textContent =
      `${serverName}${ports ? ` · ${ports}` : ''}`;

    fillServerFields(config);
    if (data.cmDescriptionPreview) {
      setCmPreviewHtml(SERVER_BRANDING_REFS, data.cmDescriptionPreview);
    }
  } catch {
    showToast('Connection error', 'error');
    closeServerConfig();
  } finally {
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
  }
}

export function closeServerConfig() {
  activeServerName = null;
  closeModal('serverConfigModal');
}

/** @param {Record<string, unknown>} config */
function fillServerFields(config) {
  fillBranding(SERVER_BRANDING_REFS, {
    description: String(config.description ?? ''),
    webLink: String(config.webLink ?? ''),
    cmDescriptionBody: String(config.cmDescriptionBody ?? ''),
    bannerImageUrl: String(config.bannerImageUrl ?? ''),
    loadingImageUrl: String(config.loadingImageUrl ?? ''),
  });
}

function readServerFields() {
  return readBranding(SERVER_BRANDING_REFS);
}

export async function saveServerConfig(e) {
  e.preventDefault();
  if (!activeServerName) return;

  const btn = document.getElementById('serverConfigSaveBtn');
  if (!(btn instanceof HTMLButtonElement)) return;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { data } = await apiPut(
      `/servers/${encodeURIComponent(activeServerName)}/config`,
      readServerFields(),
    );

    if (data.ok) {
      showToast(data.message || 'Branding saved');
      fillServerFields(data.config);
      if (data.servers) {
        renderChips(data.servers);
        const countEl = document.getElementById('serversCount');
        if (countEl) countEl.textContent = `${data.servers.length} servers`;
      }
      const chip = serverList.find((s) => s.name === activeServerName);
      document.getElementById('serverConfigTitle').textContent =
        chip?.displayName || data.config?.displayName || activeServerName;
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save branding';
  }
}

export function initServerConfigModal() {
  bindBrandingPreview(SERVER_BRANDING_REFS);
  document.getElementById('serverConfigForm')?.addEventListener('submit', saveServerConfig);
}
