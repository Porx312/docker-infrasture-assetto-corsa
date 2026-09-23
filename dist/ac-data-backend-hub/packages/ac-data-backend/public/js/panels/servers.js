import { apiGet, apiPut } from '../lib/api.js';
import {
  bindBrandingPreview,
  brandingRefs,
  fillBranding,
  readBranding,
  setCmPreviewHtml,
  seedLoadingUrlsList,
  validateLoadingImageUrls,
} from '../lib/branding.js';
import { closeModal, openModal } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { filterRowsByFleetRegion, isFleetMode } from '../lib/fleet.js';
import {
  GLOBAL_BRANDING_REFS,
  renderServerTableHtml,
  renderServerTableSkeleton,
  renderServersPanelHtml,
} from '../ui/servers-templates.js';

/** @type {Array<{ name: string; displayName?: string | null; wrapperPort?: number | null; fleetEdgeId?: string; fleetLabel?: string }>} */
let serverList = [];
let activeServerName = null;
/** @type {string} */
let activeFleetEdgeId = '';
let brandingLoadSeq = 0;

const SERVER_BRANDING_REFS = brandingRefs('sc', { loadingListMode: true });

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

function renderServerTable(servers) {
  const wrap = document.getElementById('serverTableWrap');
  if (!wrap) return;
  const filtered = filterRowsByFleetRegion(servers);
  wrap.innerHTML = renderServerTableHtml(filtered, isFleetMode());
}

export async function loadServersPanel() {
  const countEl = document.getElementById('serversCount');
  const wrap = document.getElementById('serverTableWrap');
  if (countEl) countEl.textContent = 'Loading…';
  if (wrap) wrap.innerHTML = renderServerTableSkeleton();

  const seq = ++brandingLoadSeq;

  try {
    if (isFleetMode()) {
      const [brandingRes, fleetRes] = await Promise.all([
        apiGet('/branding'),
        apiGet('/fleet/servers'),
      ]);
      if (seq !== brandingLoadSeq) return;

      if (brandingRes.data?.ok) {
        fillBranding(GLOBAL_BRANDING_REFS, brandingRes.data.branding);
      }
      if (!fleetRes.data?.ok) {
        showToast(fleetRes.data?.message || 'Failed to load fleet servers', 'error');
        return;
      }
      serverList = fleetRes.data.servers ?? [];
      renderServerTable(serverList);
      if (countEl) countEl.textContent = `${serverList.length} instances`;
      if (fleetRes.data.warnings?.length) {
        showToast(fleetRes.data.warnings.join('; '), 'error');
      }
      return;
    }

    const { data } = await apiGet('/branding');
    if (seq !== brandingLoadSeq) return;

    if (!data.ok) {
      showToast(data.message || 'Failed to load branding', 'error');
      return;
    }

    fillBranding(GLOBAL_BRANDING_REFS, data.branding);
    serverList = data.servers ?? [];
    renderServerTable(serverList);
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
  const urlError = validateLoadingImageUrls(payload.loadingImageUrls ?? []);
  if (urlError) {
    showToast(urlError, 'error');
    return;
  }

  const saveSeq = ++brandingLoadSeq;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { data } = await apiPut('/branding', payload);
    if (saveSeq !== brandingLoadSeq) return;

    if (data.ok) {
      showToast(data.warning || data.message || 'Branding saved');
      fillBranding(GLOBAL_BRANDING_REFS, data.branding ?? payload);
      if (data.servers?.length) {
        serverList = data.servers;
        renderServerTable(serverList);
      }
      await loadServersPanel();
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
      btn.textContent = 'Save global branding';
    }
  }
}

/**
 * @param {string} serverName
 * @param {string} [fleetEdgeId]
 */
export async function openServerConfig(serverName, fleetEdgeId = '') {
  activeServerName = serverName;
  activeFleetEdgeId = fleetEdgeId || '';
  const row = serverList.find(
    (s) => s.name === serverName && (!activeFleetEdgeId || s.fleetEdgeId === activeFleetEdgeId),
  );

  document.getElementById('serverConfigTitle').textContent = row?.displayName || serverName;
  document.getElementById('serverConfigMeta').textContent = `${serverName} · loading…`;
  openModal('serverConfigModal');

  const saveBtn = document.getElementById('serverConfigSaveBtn');
  if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;

  try {
    const { data } = await apiGet(
      `/servers/${encodeURIComponent(serverName)}/config`,
      activeFleetEdgeId || undefined,
    );
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

    const region = row?.fleetLabel ? `${row.fleetLabel} · ` : '';
    document.getElementById('serverConfigMeta').textContent =
      `${region}${serverName}${ports ? ` · ${ports}` : ''}`;

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
  activeFleetEdgeId = '';
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
    loadingImageUrls: Array.isArray(config.loadingImageUrls) ? config.loadingImageUrls : undefined,
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

  const payload = readServerFields();
  const urlError = validateLoadingImageUrls(payload.loadingImageUrls ?? []);
  if (urlError) {
    showToast(urlError, 'error');
    btn.disabled = false;
    btn.textContent = 'Save branding';
    return;
  }

  try {
    const { data } = await apiPut(
      `/servers/${encodeURIComponent(activeServerName)}/config`,
      payload,
      activeFleetEdgeId || undefined,
    );

    if (data.ok) {
      showToast(data.message || 'Branding saved');
      fillServerFields(data.config);
      await loadServersPanel();
      const row = serverList.find((s) => s.name === activeServerName);
      document.getElementById('serverConfigTitle').textContent =
        row?.displayName || data.config?.displayName || activeServerName;
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
  seedLoadingUrlsList(SERVER_BRANDING_REFS);
  bindBrandingPreview(SERVER_BRANDING_REFS);
  document.getElementById('serverConfigForm')?.addEventListener('submit', saveServerConfig);
}
