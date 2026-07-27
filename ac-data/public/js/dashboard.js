import { TABS, getTab } from './config/tabs.js';
import { checkAuth, logout } from './lib/auth.js';
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
  closeServerConfig,
  initServerConfigModal,
  loadServersPanel,
  mountServersPanel,
  openServerConfig,
} from './panels/servers.js';

let currentTab = 'cars';

function renderTabs() {
  const nav = document.getElementById('tabNav');
  if (!nav) return;

  nav.innerHTML = TABS.map(
    (tab) =>
      `<button type="button" class="tab-btn${tab.id === currentTab ? ' active' : ''}" data-tab="${tab.id}">${tab.label}</button>`,
  ).join('');

  nav.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/** @param {string} tabId */
function switchTab(tabId) {
  if (!tabId) return;
  currentTab = tabId;
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
  } else {
    mountContentPanel(tab.id, container);
  }
}

function loadActivePanel() {
  if (getTab(currentTab).kind === 'servers') {
    loadServersPanel();
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
  bindModal({ id: 'serverConfigModal' }, closeServerConfig);
  document.getElementById('serverConfigCloseBtn')?.addEventListener('click', closeServerConfig);
  document.getElementById('serverConfigCancelBtn')?.addEventListener('click', closeServerConfig);

  document.getElementById('panelContainer')?.addEventListener('click', (e) => {
    const serverChip = e.target.closest('[data-server-name]');
    if (serverChip) {
      openServerConfig(serverChip.dataset.serverName);
      return;
    }

    const modCard = e.target.closest('[data-open-mod]');
    if (modCard) {
      openContentDetail(modCard.dataset.openMod, modCard.dataset.name);
    }
  });

  bindEscapeStack([
    { id: 'confirmModal', close: () => hideConfirm(false) },
    { id: 'serverConfigModal', close: closeServerConfig },
    { id: 'modModal', close: closeContentDetail },
  ]);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindGlobalHandlers();

  if (!(await checkAuth())) return;

  renderTabs();
  renderActivePanel();
  loadActivePanel();
});
