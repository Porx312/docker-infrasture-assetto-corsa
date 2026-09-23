import { apiGet, apiPost, apiPut } from '../lib/api.js';
import {
  bindBrandingPreview,
  brandingRefs,
  fillBranding,
  readBranding,
  renderBrandingFieldsHtml,
  seedLoadingUrlsList,
  setCmPreviewHtml,
  validateLoadingImageUrls,
} from '../lib/branding.js';
import { closeModal, openModal } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';
import { filterRowsByFleetRegion, getFleetRegionFilter, isFleetMode } from '../lib/fleet.js';
import {
  GLOBAL_BRANDING_REFS,
  renderGlobalBrandingTargetsHtml,
  renderServerTableHtml,
  renderServerTableSkeleton,
  renderServersPanelHtml,
  serverTargetKey,
} from '../ui/servers-templates.js';

/** @type {Array<{ name: string; displayName?: string | null; wrapperPort?: number | null; fleetEdgeId?: string; fleetLabel?: string }>} */
let serverList = [];
let activeServerName = null;
/** @type {string} */
let activeFleetEdgeId = '';
let brandingLoadSeq = 0;
/** @type {Set<string>} */
let globalBrandingSelectedKeys = new Set();
let globalBrandingModalReady = false;
/** @type {import('../lib/branding.js').BrandingValues | null} */
let cachedGlobalBranding = null;
/** @type {Map<string, { running?: boolean; label?: string }>} */
const runtimeByKey = new Map();

const SERVER_BRANDING_REFS = brandingRefs('sc', { loadingListMode: true });

/**
 * @param {HTMLElement} container
 */
export function mountServersPanel(container) {
  container.innerHTML = renderServersPanelHtml();
  document.getElementById('globalBrandingOpenBtn')?.addEventListener('click', () => {
    void openGlobalBrandingModal();
  });
  document.getElementById('serverProvisionOpenBtn')?.addEventListener('click', () => {
    openServerProvisionModal();
  });
}

function renderServerTable(servers) {
  const wrap = document.getElementById('serverTableWrap');
  if (!wrap) return;
  const filtered = filterRowsByFleetRegion(servers);
  wrap.innerHTML = renderServerTableHtml(filtered, isFleetMode(), runtimeByKey);
}

async function refreshRuntimeStatuses(servers) {
  const rows = filterRowsByFleetRegion(servers);
  await Promise.all(
    rows.map(async (server) => {
      const key = serverTargetKey(server.name, server.fleetEdgeId || '');
      try {
        const { data } = await apiGet(
          `/servers/${encodeURIComponent(server.name)}/runtime`,
          server.fleetEdgeId || undefined,
        );
        if (data.ok && data.runtime) {
          runtimeByKey.set(key, {
            running: data.runtime.running,
            label: data.runtime.running ? 'Running' : 'Stopped',
          });
        } else {
          runtimeByKey.set(key, { label: 'Unknown' });
        }
      } catch {
        runtimeByKey.set(key, { label: 'Unknown' });
      }
    }),
  );
  renderServerTable(serverList);
}

function visibleServerRows() {
  return filterRowsByFleetRegion(serverList);
}

function selectAllVisibleServerTargets() {
  globalBrandingSelectedKeys.clear();
  for (const row of visibleServerRows()) {
    globalBrandingSelectedKeys.add(serverTargetKey(row.name, row.fleetEdgeId || ''));
  }
}

function renderGlobalBrandingTargets() {
  const container = document.getElementById('globalBrandingTargets');
  const empty = document.getElementById('globalBrandingTargetsEmpty');
  if (!container || !empty) return;

  const rows = visibleServerRows();
  if (!rows.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.innerHTML = renderGlobalBrandingTargetsHtml(
    rows,
    globalBrandingSelectedKeys,
    isFleetMode(),
  );
}

function readGlobalBrandingTargetSelection() {
  /** @type {Array<{ name: string; fleetEdgeId: string }>} */
  const selected = [];
  for (const el of document.querySelectorAll('#globalBrandingTargets input[type="checkbox"]')) {
    if (!(el instanceof HTMLInputElement) || !el.checked) continue;
    const name = el.dataset.serverName;
    if (!name) continue;
    selected.push({ name, fleetEdgeId: el.dataset.fleetEdgeId || '' });
  }
  return selected;
}

function syncGlobalSelectionFromDom() {
  globalBrandingSelectedKeys = new Set();
  for (const el of document.querySelectorAll('#globalBrandingTargets input[type="checkbox"]')) {
    if (!(el instanceof HTMLInputElement) || !el.checked) continue;
    const key = el.dataset.targetKey;
    if (key) globalBrandingSelectedKeys.add(key);
  }
}

export function initGlobalBrandingModal() {
  if (globalBrandingModalReady) return;
  globalBrandingModalReady = true;

  const mount = document.getElementById('globalBrandingFieldsMount');
  if (mount) {
    mount.innerHTML = renderBrandingFieldsHtml(GLOBAL_BRANDING_REFS, {
      descriptionRows: 3,
      cmBodyRows: 5,
      bannerLabel: 'Banner image (CM description)',
      loadingLabel: 'Loading screen images',
      loadingListMode: true,
      previewClass: 'modal-server-preview',
    });
  }

  seedLoadingUrlsList(GLOBAL_BRANDING_REFS);
  bindBrandingPreview(GLOBAL_BRANDING_REFS);

  document.getElementById('globalBrandingForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void saveGlobalBranding();
  });

  document.getElementById('globalBrandingModal')?.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('button') : null;
    if (!target) return;
    if (target.id === 'globalBrandingSelectAll') {
      e.preventDefault();
      selectAllVisibleServerTargets();
      renderGlobalBrandingTargets();
      return;
    }
    if (target.id === 'globalBrandingSelectNone') {
      e.preventDefault();
      globalBrandingSelectedKeys.clear();
      renderGlobalBrandingTargets();
    }
  });

  document.getElementById('globalBrandingTargets')?.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'checkbox') return;
    syncGlobalSelectionFromDom();
  });
}

export async function openGlobalBrandingModal() {
  initGlobalBrandingModal();
  if (globalBrandingSelectedKeys.size === 0 && visibleServerRows().length > 0) {
    selectAllVisibleServerTargets();
  }
  renderGlobalBrandingTargets();

  if (cachedGlobalBranding) {
    fillBranding(GLOBAL_BRANDING_REFS, cachedGlobalBranding);
  } else {
    try {
      const { data } = await apiGet('/branding');
      if (data.ok && data.branding) {
        cachedGlobalBranding = data.branding;
        fillBranding(GLOBAL_BRANDING_REFS, data.branding);
      }
    } catch {
      showToast('Could not load saved branding defaults', 'error');
    }
  }

  openModal('globalBrandingModal');
}

export function closeGlobalBrandingModal() {
  syncGlobalSelectionFromDom();
  closeModal('globalBrandingModal');
}

export async function loadServersPanel() {
  const countEl = document.getElementById('serversCount');
  const wrap = document.getElementById('serverTableWrap');
  if (countEl) countEl.textContent = 'Loading…';
  if (wrap) wrap.innerHTML = renderServerTableSkeleton(isFleetMode());

  const seq = ++brandingLoadSeq;

  try {
    if (isFleetMode()) {
      const [brandingRes, fleetRes] = await Promise.all([
        apiGet('/branding'),
        apiGet('/fleet/servers'),
      ]);
      if (seq !== brandingLoadSeq) return;

      if (brandingRes.data?.ok) {
        cachedGlobalBranding = brandingRes.data.branding;
      }
      if (!fleetRes.data?.ok) {
        showToast(fleetRes.data?.message || 'Failed to load fleet servers', 'error');
        return;
      }
      serverList = fleetRes.data.servers ?? [];
      renderServerTable(serverList);
      void refreshRuntimeStatuses(serverList);
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

    cachedGlobalBranding = data.branding;
    serverList = data.servers ?? [];
    renderServerTable(serverList);
    void refreshRuntimeStatuses(serverList);
    if (countEl) countEl.textContent = `${data.serverCount} servers`;
  } catch {
    if (seq !== brandingLoadSeq) return;
    showToast('Connection error', 'error');
    if (countEl) countEl.textContent = '';
  }
}

/**
 * @param {Record<string, unknown>} payload
 * @param {Array<{ name: string; fleetEdgeId: string }>} targets
 */
async function applyBrandingToTargets(payload, targets) {
  /** @type {Map<string, string[]>} */
  const byEdge = new Map();
  for (const target of targets) {
    const edgeKey = target.fleetEdgeId || '';
    const list = byEdge.get(edgeKey) ?? [];
    list.push(target.name);
    byEdge.set(edgeKey, list);
  }

  let lastMessage = '';
  let hadError = false;

  for (const [fleetEdgeId, serverNames] of byEdge) {
    const body = { ...payload, serverNames };
    const { data } = await apiPut('/branding', body, fleetEdgeId || undefined);
    if (!data.ok) {
      hadError = true;
      showToast(data.message || 'Save failed', 'error');
    } else {
      lastMessage = data.message || data.warning || 'Branding saved';
      if (data.branding) cachedGlobalBranding = data.branding;
    }
  }

  return { hadError, lastMessage };
}

async function saveGlobalBranding() {
  const btn = document.getElementById('globalBrandingSaveBtn');
  if (!(btn instanceof HTMLButtonElement)) return;

  syncGlobalSelectionFromDom();
  const targets = readGlobalBrandingTargetSelection();
  if (!targets.length) {
    showToast('Select at least one instance', 'error');
    return;
  }

  const payload = readBranding(GLOBAL_BRANDING_REFS);
  const urlError = validateLoadingImageUrls(payload.loadingImageUrls ?? []);
  if (urlError) {
    showToast(urlError, 'error');
    return;
  }

  const saveSeq = ++brandingLoadSeq;

  btn.disabled = true;
  btn.textContent = 'Applying…';

  try {
    const { hadError, lastMessage } = await applyBrandingToTargets(payload, targets);
    if (saveSeq !== brandingLoadSeq) return;

    if (!hadError) {
      showToast(lastMessage || `Branding applied to ${targets.length} instance(s)`);
      fillBranding(GLOBAL_BRANDING_REFS, cachedGlobalBranding ?? payload);
      closeGlobalBrandingModal();
      await loadServersPanel();
    }
  } catch {
    if (saveSeq === brandingLoadSeq) {
      showToast('Connection error', 'error');
    }
  } finally {
    if (saveSeq === brandingLoadSeq) {
      btn.disabled = false;
      btn.textContent = 'Apply branding';
    }
  }
}

function setServerManageTab(tabId) {
  for (const btn of document.querySelectorAll('.server-manage-tab')) {
    btn.classList.toggle('active', btn instanceof HTMLElement && btn.dataset.serverTab === tabId);
  }
  for (const panel of document.querySelectorAll('[data-server-panel]')) {
    panel.classList.toggle('hidden', panel instanceof HTMLElement && panel.dataset.serverPanel !== tabId);
  }
  const brandingFooter = document.getElementById('serverConfigSaveBtn');
  if (brandingFooter instanceof HTMLElement) {
    brandingFooter.classList.toggle('hidden', tabId !== 'branding');
  }
}

/** @param {Record<string, unknown> | undefined} runtime */
function renderRuntimeOverview(runtime) {
  const badge = document.getElementById('serverRuntimeBadge');
  const pidEl = document.getElementById('serverRuntimePid');
  const portsEl = document.getElementById('serverRuntimePorts');
  const startBtn = document.getElementById('serverStartBtn');
  const stopBtn = document.getElementById('serverStopBtn');
  const restartBtn = document.getElementById('serverRestartBtn');

  const running = Boolean(runtime?.running);
  if (badge) {
    badge.textContent = running ? 'Running' : 'Stopped';
    badge.className = `server-status-badge ${running ? 'server-status-running' : 'server-status-stopped'}`;
  }
  if (pidEl) {
    pidEl.textContent = runtime?.pid ? `PID ${runtime.pid}` : '';
  }
  if (portsEl) {
    const rows = [
      ['HTTP', runtime?.httpPort],
      ['UDP', runtime?.udpPort],
      ['TCP', runtime?.tcpPort],
      ['CM wrapper', runtime?.wrapperPort],
    ]
      .filter(([, v]) => v != null)
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
    portsEl.innerHTML = rows;
  }
  if (startBtn instanceof HTMLButtonElement) startBtn.disabled = running;
  if (stopBtn instanceof HTMLButtonElement) stopBtn.disabled = !running;
  if (restartBtn instanceof HTMLButtonElement) restartBtn.disabled = false;
}

async function reloadActiveServerRuntime() {
  if (!activeServerName) return;
  const { data } = await apiGet(
    `/servers/${encodeURIComponent(activeServerName)}/runtime`,
    activeFleetEdgeId || undefined,
  );
  if (data.ok && data.runtime) {
    renderRuntimeOverview(data.runtime);
    const key = serverTargetKey(activeServerName, activeFleetEdgeId);
    runtimeByKey.set(key, {
      running: data.runtime.running,
      label: data.runtime.running ? 'Running' : 'Stopped',
    });
    renderServerTable(serverList);
  }
}

async function runServerLifecycle(action) {
  if (!activeServerName) return;
  const path = `/servers/${encodeURIComponent(activeServerName)}/${action}`;
  const { res, data } = await apiPost(path, {}, activeFleetEdgeId || undefined);
  if (data.ok) {
    showToast(data.message || `${action} ok`);
    renderRuntimeOverview(data.runtime ?? { running: data.running, pid: data.pid });
    await reloadActiveServerRuntime();
  } else if (res.status === 409 && data.code === 'MODS_NOT_READY') {
    showToast('Required mods not READY on this VPS', 'error');
    await reloadServerModReadiness();
  } else {
    showToast(data.message || `${action} failed`, 'error');
  }
}

async function reloadServerModReadiness() {
  const listEl = document.getElementById('serverModReadinessList');
  const syncBtn = document.getElementById('serverModSyncMissingBtn');
  if (!listEl || !activeServerName) return;
  const trackEl = document.getElementById('scTrack');
  const carsEl = document.getElementById('scCars');
  const { data } = await apiPost(
    `/servers/${encodeURIComponent(activeServerName)}/mods/refresh`,
    {
      track: trackEl instanceof HTMLInputElement ? trackEl.value.trim() : '',
      cars: carsEl instanceof HTMLInputElement ? carsEl.value.trim() : '',
    },
    activeFleetEdgeId || undefined,
  );
  if (!data.ok) {
    listEl.innerHTML = `<li class="panel-hint">${data.message || 'Mod catalog unavailable'}</li>`;
    syncBtn?.classList.add('hidden');
    return;
  }
  const items = data.items || [];
  if (!items.length) {
    listEl.innerHTML = '<li class="panel-hint">No mapped mods (set track/cars in lobby tab).</li>';
    syncBtn?.classList.add('hidden');
    return;
  }
  listEl.innerHTML = items
    .map((item) => {
      const ok = item.status === 'READY';
      const label = item.displayName || item.acContentSlug;
      const ver = item.versionLabel ? ` v${item.versionLabel}` : '';
      return `<li>${ok ? '✓' : '✗'} ${label}${ver} · <span class="badge">${item.status}</span></li>`;
    })
    .join('');
  const needsSync = items.some((item) => item.status !== 'READY');
  if (syncBtn instanceof HTMLButtonElement) {
    syncBtn.classList.toggle('hidden', !needsSync);
  }
}

async function syncMissingServerModsClick() {
  if (!activeServerName) return;
  const { data } = await apiPost(
    `/servers/${encodeURIComponent(activeServerName)}/mods/sync-missing`,
    {},
    activeFleetEdgeId || undefined,
  );
  showToast(data.ok ? `Enqueued ${data.enqueued} sync job(s)` : data.message || 'Failed', data.ok ? 'success' : 'error');
  await reloadServerModReadiness();
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
  setServerManageTab('overview');
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
    const region = row?.fleetLabel ? `${row.fleetLabel} · ` : '';
    document.getElementById('serverConfigMeta').textContent = `${region}${serverName}`;

    fillServerFields(config);
    fillLobbyFields(config);
    renderRuntimeOverview(data.runtime);
    if (data.cmDescriptionPreview) {
      setCmPreviewHtml(SERVER_BRANDING_REFS, data.cmDescriptionPreview);
    }
    await reloadServerModReadiness();
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

/** @param {Record<string, unknown>} config */
function fillLobbyFields(config) {
  const nameEl = document.getElementById('scDisplayName');
  const passEl = document.getElementById('scPassword');
  const maxEl = document.getElementById('scMaxClients');
  const regEl = document.getElementById('scRegisterLobby');
  const trackEl = document.getElementById('scTrack');
  const cfgTrackEl = document.getElementById('scConfigTrack');
  const carsEl = document.getElementById('scCars');
  const fuelEl = document.getElementById('scFuelRate');
  const tyreEl = document.getElementById('scTyreBlankets');
  const weatherGfxEl = document.getElementById('scWeatherGraphics');
  const weatherAmbEl = document.getElementById('scWeatherAmbient');
  const weatherRoadEl = document.getElementById('scWeatherRoad');
  if (nameEl instanceof HTMLInputElement) nameEl.value = String(config.displayName ?? '');
  if (passEl instanceof HTMLInputElement) passEl.value = String(config.password ?? '');
  if (maxEl instanceof HTMLInputElement) maxEl.value = String(config.maxClients ?? '');
  if (regEl instanceof HTMLInputElement) regEl.checked = Boolean(config.registerToLobby);
  if (trackEl instanceof HTMLInputElement) trackEl.value = String(config.track ?? '');
  if (cfgTrackEl instanceof HTMLInputElement) cfgTrackEl.value = String(config.configTrack ?? '');
  if (carsEl instanceof HTMLInputElement) carsEl.value = String(config.cars ?? '');
  if (fuelEl instanceof HTMLInputElement) fuelEl.value = String(config.fuelRate ?? 0);
  if (tyreEl instanceof HTMLInputElement) tyreEl.checked = Boolean(config.tyreBlanketsAllowed);
  if (weatherGfxEl instanceof HTMLInputElement) {
    weatherGfxEl.value = String(config.weatherGraphics ?? '3_clear');
  }
  if (weatherAmbEl instanceof HTMLInputElement) {
    weatherAmbEl.value = String(config.weatherAmbientC ?? 23);
  }
  if (weatherRoadEl instanceof HTMLInputElement) {
    weatherRoadEl.value = String(config.weatherRoadC ?? 11);
  }
}

function readLobbyFields() {
  const nameEl = document.getElementById('scDisplayName');
  const passEl = document.getElementById('scPassword');
  const maxEl = document.getElementById('scMaxClients');
  const regEl = document.getElementById('scRegisterLobby');
  const trackEl = document.getElementById('scTrack');
  const cfgTrackEl = document.getElementById('scConfigTrack');
  const carsEl = document.getElementById('scCars');
  const fuelEl = document.getElementById('scFuelRate');
  const tyreEl = document.getElementById('scTyreBlankets');
  const weatherGfxEl = document.getElementById('scWeatherGraphics');
  const weatherAmbEl = document.getElementById('scWeatherAmbient');
  const weatherRoadEl = document.getElementById('scWeatherRoad');
  return {
    displayName: nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '',
    password: passEl instanceof HTMLInputElement ? passEl.value : '',
    maxClients: maxEl instanceof HTMLInputElement ? Number.parseInt(maxEl.value, 10) : 0,
    registerToLobby: regEl instanceof HTMLInputElement ? regEl.checked : false,
    track: trackEl instanceof HTMLInputElement ? trackEl.value.trim() : '',
    configTrack: cfgTrackEl instanceof HTMLInputElement ? cfgTrackEl.value.trim() : '',
    cars: carsEl instanceof HTMLInputElement ? carsEl.value.trim() : '',
    fuelRate: fuelEl instanceof HTMLInputElement ? Number.parseFloat(fuelEl.value) : 0,
    tyreBlanketsAllowed: tyreEl instanceof HTMLInputElement ? tyreEl.checked : true,
    weatherGraphics: weatherGfxEl instanceof HTMLInputElement ? weatherGfxEl.value.trim() : '',
    weatherAmbientC: weatherAmbEl instanceof HTMLInputElement
      ? Number.parseFloat(weatherAmbEl.value)
      : 23,
    weatherRoadC: weatherRoadEl instanceof HTMLInputElement
      ? Number.parseFloat(weatherRoadEl.value)
      : 11,
  };
}

function readServerFields() {
  return readBranding(SERVER_BRANDING_REFS);
}

async function saveServerLobby(e) {
  e.preventDefault();
  if (!activeServerName) return;
  const btn = document.getElementById('serverLobbySaveBtn');
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  const payload = readLobbyFields();
  try {
    const { data } = await apiPut(
      `/servers/${encodeURIComponent(activeServerName)}/config`,
      payload,
      activeFleetEdgeId || undefined,
    );
    if (data.ok) {
      showToast(data.message || 'Gameplay settings saved');
      fillLobbyFields(data.config);
      fillServerFields(data.config);
      document.getElementById('serverLobbyRestartBtn')?.classList.remove('hidden');
      await loadServersPanel();
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  } finally {
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = false;
      btn.textContent = 'Save gameplay settings';
    }
  }
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

async function resolveProvisionFleetEdgeId() {
  const filtered = getFleetRegionFilter();
  if (filtered) return filtered;
  if (!isFleetMode()) return '';
  const { data } = await apiGet('/fleet/edges');
  const edges = data.edges ?? [];
  return edges[0]?.id ?? '';
}

export function openServerProvisionModal() {
  document.getElementById('provisionFleetHint')?.classList.toggle('hidden', !isFleetMode());
  document.getElementById('provisionDisplayName').value = '';
  const startEl = document.getElementById('provisionStartAfter');
  if (startEl instanceof HTMLInputElement) startEl.checked = false;
  openModal('serverProvisionModal');
}

export function closeServerProvisionModal() {
  closeModal('serverProvisionModal');
}

async function submitServerProvision(e) {
  e.preventDefault();
  const btn = document.getElementById('serverProvisionSubmitBtn');
  const nameEl = document.getElementById('provisionDisplayName');
  const startEl = document.getElementById('provisionStartAfter');
  const fleetEdgeId = await resolveProvisionFleetEdgeId();
  if (isFleetMode() && !fleetEdgeId) {
    showToast('Select a region in the header first', 'error');
    return;
  }
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = 'Creating…';
  }
  try {
    const { data } = await apiPost(
      '/servers/provision',
      {
        displayName: nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '',
        start: startEl instanceof HTMLInputElement ? startEl.checked : false,
      },
      fleetEdgeId || undefined,
    );
    if (data.ok) {
      showToast(data.message || 'Instance created');
      closeServerProvisionModal();
      await loadServersPanel();
    } else {
      showToast(data.message || 'Create failed', 'error');
    }
  } catch {
    showToast('Connection error', 'error');
  } finally {
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = false;
      btn.textContent = 'Create instance';
    }
  }
}

export function initServerConfigModal() {
  seedLoadingUrlsList(SERVER_BRANDING_REFS);
  bindBrandingPreview(SERVER_BRANDING_REFS);
  document.getElementById('serverConfigForm')?.addEventListener('submit', saveServerConfig);
  document.getElementById('serverLobbyForm')?.addEventListener('submit', (e) => {
    void saveServerLobby(e);
  });
  document.getElementById('serverManageTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-server-tab]');
    if (tab instanceof HTMLElement && tab.dataset.serverTab) {
      setServerManageTab(tab.dataset.serverTab);
    }
  });
  document.getElementById('serverModSyncMissingBtn')?.addEventListener('click', () => {
    void syncMissingServerModsClick();
  });
  document.getElementById('serverStartBtn')?.addEventListener('click', () => {
    void runServerLifecycle('start');
  });
  document.getElementById('serverStopBtn')?.addEventListener('click', () => {
    void runServerLifecycle('stop');
  });
  document.getElementById('serverRestartBtn')?.addEventListener('click', () => {
    void runServerLifecycle('restart');
  });
  document.getElementById('serverLobbyRestartBtn')?.addEventListener('click', () => {
    void runServerLifecycle('restart');
  });
  document.getElementById('serverProvisionForm')?.addEventListener('submit', (e) => {
    void submitServerProvision(e);
  });
}
