import { TABS, getTab } from './config/tabs.js';
import { checkAuth, logout } from './lib/auth.js';
import { initFleetSelector } from './lib/fleet-ui.js';
import { showToast } from './lib/toast.js';
import {
  bindConfirmModal,
  bindEscapeStack,
  bindModal,
  hideConfirm,
} from './lib/modal.js';
import {
  closeContentDetail,
  handleModDelete,
  loadContent,
  mountContentPanel,
  openContentDetail,
} from './panels/content.js';
import {
  closeGlobalBrandingModal,
  closeServerConfig,
  closeServerProvisionModal,
  initGlobalBrandingModal,
  initServerConfigModal,
  loadServersPanel,
  mountServersPanel,
  openServerConfig,
} from './panels/servers.js';
import {
  loadActivityPanel,
  mountActivityPanel,
  unmountActivityPanel,
} from './panels/activity.js';
import {
  loadHudReleasesPanel,
  mountHudReleasesPanel,
} from './panels/hud-releases.js';
import {
  loadModDistributionPanel,
  mountModDistributionPanel,
} from './panels/mod-distribution.js';

const TAB_STORAGE_KEY = 'adminTab';

/** @returns {string} */
function resolveInitialTab() {
  const hash = location.hash.replace(/^#/, '').trim();
  if (hash && getTab(hash).id === hash) return hash;
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (stored && getTab(stored).id === stored) return stored;
  } catch {
    /* ignore */
  }
  return 'cars';
}

let currentTab = resolveInitialTab();

function persistTab(tabId) {
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, tabId);
  } catch {
    /* ignore */
  }
  if (location.hash !== `#${tabId}`) {
    history.replaceState(null, '', `#${tabId}`);
  }
}

function renderTabs() {
  const nav = document.getElementById('tabNav');
  if (!nav) return;

  nav.innerHTML = TABS.map(
    (tab) =>
      `<button type="button" class="tab-btn${tab.id === currentTab ? ' active' : ''}" data-tab="${tab.id}" data-kind="${tab.kind}">${tab.label}</button>`,
  ).join('');

  nav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/** @param {string} tabId */
function switchTab(tabId) {
  if (!tabId) return;
  const prevKind = getTab(currentTab).kind;
  currentTab = tabId;
  persistTab(tabId);
  if (prevKind === 'activity' && getTab(currentTab).kind !== 'activity') {
    unmountActivityPanel();
  }
  renderTabs();
  renderActivePanel();
  loadActivePanel();
}

function renderActivePanel() {
  const container = document.getElementById('panelContainer');
  if (!container) return;

  const tab = getTab(currentTab);
  if (tab.kind === 'servers') {
    mountServersPanel(container);
  } else if (tab.kind === 'activity') {
    mountActivityPanel(container);
  } else if (tab.kind === 'hud') {
    mountHudReleasesPanel(container);
  } else if (tab.kind === 'mods') {
    mountModDistributionPanel(container);
  } else {
    mountContentPanel(tab.id, container);
  }
}

function loadActivePanel() {
  const kind = getTab(currentTab).kind;
  if (kind === 'servers') {
    loadServersPanel();
  } else if (kind === 'activity') {
    loadActivityPanel();
  } else if (kind === 'hud') {
    loadHudReleasesPanel();
  } else if (kind === 'mods') {
    const container = document.getElementById('panelContainer');
    if (container) void loadModDistributionPanel(container);
  } else {
    loadContent(currentTab);
  }
}

function bindGlobalHandlers() {
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  bindConfirmModal();
  bindModal({ id: 'modModal' }, closeContentDetail);
  document.getElementById('modCloseBtn')?.addEventListener('click', closeContentDetail);

  document.getElementById('modDeleteBtn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    handleModDelete(btn.dataset.delete, btn.dataset.name);
  });

  initServerConfigModal();
  initGlobalBrandingModal();
  bindModal({ id: 'serverConfigModal' }, closeServerConfig);
  bindModal({ id: 'globalBrandingModal' }, closeGlobalBrandingModal);
  document.getElementById('serverConfigCloseBtn')?.addEventListener('click', closeServerConfig);
  document.getElementById('serverConfigCancelBtn')?.addEventListener('click', closeServerConfig);
  document.getElementById('globalBrandingCloseBtn')?.addEventListener('click', closeGlobalBrandingModal);
  document.getElementById('globalBrandingCancelBtn')?.addEventListener('click', closeGlobalBrandingModal);
  bindModal({ id: 'serverProvisionModal' }, closeServerProvisionModal);
  document.getElementById('serverProvisionCloseBtn')?.addEventListener('click', closeServerProvisionModal);
  document.getElementById('serverProvisionCancelBtn')?.addEventListener('click', closeServerProvisionModal);

  document.getElementById('panelContainer')?.addEventListener('click', (e) => {
    const configBtn = e.target.closest('[data-server-config]');
    if (configBtn) {
      openServerConfig(configBtn.dataset.serverConfig, configBtn.dataset.fleetEdgeId || '');
      return;
    }

    const modCard = e.target.closest('[data-open-mod]');
    if (modCard) {
      openContentDetail(modCard.dataset.openMod, modCard.dataset.name);
    }
  });

  bindEscapeStack([
    { id: 'confirmModal', close: () => hideConfirm(false) },
    { id: 'globalBrandingModal', close: closeGlobalBrandingModal },
    { id: 'serverProvisionModal', close: closeServerProvisionModal },
    { id: 'serverConfigModal', close: closeServerConfig },
    { id: 'modModal', close: closeContentDetail },
  ]);

  window.addEventListener('fleet-edge-changed', () => {
    loadActivePanel();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindGlobalHandlers();

  if (!(await checkAuth())) return;

  await initFleetSelector(
    document.getElementById('fleetEdgeSelect'),
    document.getElementById('fleetEdgeLabel'),
  );

  persistTab(currentTab);
  renderTabs();
  renderActivePanel();
  loadActivePanel();
});
