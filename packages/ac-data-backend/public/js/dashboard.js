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
  loadModCatalog,
  mountModCatalogPanel,
  openCatalogDistribution,
} from './panels/mod-catalog.js';
import {
  closeGlobalBrandingModal,
  closeLoadingScreensModal,
  closeServerConfig,
  closeServerProvisionModal,
  initGlobalBrandingModal,
  initLoadingScreensModal,
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
  if (hash === 'mod-distribution') return 'fleet-deploy';
  if (hash && getTab(hash).id === hash) return hash;
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'mod-distribution') return 'fleet-deploy';
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
  if (tabId === 'mod-distribution') tabId = 'fleet-deploy';
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
  } else if (tab.kind === 'mod-catalog') {
    mountModCatalogPanel(tab.id, container);
  } else {
    mountContentPanel(tab.id, container);
  }
}

function loadActivePanel() {
  const tab = getTab(currentTab);
  const kind = tab.kind;
  if (kind === 'servers') {
    loadServersPanel();
  } else if (kind === 'activity') {
    loadActivityPanel();
  } else if (kind === 'hud') {
    loadHudReleasesPanel();
  } else if (kind === 'mods') {
    const container = document.getElementById('panelContainer');
    if (container) void loadModDistributionPanel(container);
  } else if (kind === 'mod-catalog') {
    void loadModCatalog(tab.id);
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
  initLoadingScreensModal();
  bindModal({ id: 'serverConfigModal' }, closeServerConfig);
  bindModal({ id: 'globalBrandingModal' }, closeGlobalBrandingModal);
  bindModal({ id: 'loadingScreensModal' }, closeLoadingScreensModal);
  document.getElementById('serverConfigCloseBtn')?.addEventListener('click', closeServerConfig);
  document.getElementById('serverConfigCancelBtn')?.addEventListener('click', closeServerConfig);
  document.getElementById('globalBrandingCloseBtn')?.addEventListener('click', closeGlobalBrandingModal);
  document.getElementById('globalBrandingCancelBtn')?.addEventListener('click', closeGlobalBrandingModal);
  document.getElementById('loadingScreensCloseBtn')?.addEventListener('click', closeLoadingScreensModal);
  document.getElementById('loadingScreensDoneBtn')?.addEventListener('click', closeLoadingScreensModal);
  bindModal({ id: 'serverProvisionModal' }, closeServerProvisionModal);
  document.getElementById('serverProvisionCloseBtn')?.addEventListener('click', closeServerProvisionModal);
  document.getElementById('serverProvisionCancelBtn')?.addEventListener('click', closeServerProvisionModal);

  document.getElementById('panelContainer')?.addEventListener('click', (e) => {
    const copyJoinBtn = e.target.closest('[data-copy-join-url]');
    if (copyJoinBtn instanceof HTMLElement) {
      const url = copyJoinBtn.dataset.copyJoinUrl || '';
      if (url) {
        void navigator.clipboard.writeText(url).then(
          () => showToast('Join link copied', 'success'),
          () => showToast('Could not copy join link', 'error'),
        );
      }
      return;
    }

    const configBtn = e.target.closest('[data-server-config]');
    if (configBtn) {
      openServerConfig(configBtn.dataset.serverConfig, configBtn.dataset.fleetEdgeId || '');
      return;
    }

    const catalogCard = e.target.closest('[data-open-catalog]');
    if (catalogCard) {
      void openCatalogDistribution(
        catalogCard.dataset.openCatalog,
        catalogCard.dataset.artifactId,
        catalogCard.dataset.packageName,
        { packageId: catalogCard.dataset.packageId },
      );
      return;
    }

    const modCard = e.target.closest('[data-open-mod]');
    if (modCard) {
      openContentDetail(modCard.dataset.openMod, modCard.dataset.name);
    }
  });

  bindEscapeStack([
    { id: 'confirmModal', close: () => hideConfirm(false) },
    { id: 'loadingScreensModal', close: closeLoadingScreensModal },
    { id: 'globalBrandingModal', close: closeGlobalBrandingModal },
    { id: 'serverProvisionModal', close: closeServerProvisionModal },
    { id: 'serverConfigModal', close: closeServerConfig },
    { id: 'modModal', close: closeContentDetail },
  ]);

  window.addEventListener('fleet-edge-changed', () => {
    loadActivePanel();
  });

  window.addEventListener('hashchange', () => {
    const hash = location.hash.replace(/^#/, '').trim();
    if (!hash) return;
    const resolved = hash === 'mod-distribution' ? 'fleet-deploy' : hash;
    if (getTab(resolved).id === resolved && resolved !== currentTab) {
      switchTab(resolved);
    }
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
