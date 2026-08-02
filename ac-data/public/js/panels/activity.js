import { apiGet } from '../lib/api.js';
import { showToast } from '../lib/toast.js';
import {
  browserTzOffsetMinutes,
  derivePlayersFromTimeline,
  formatActivitySummaryLabel,
  localIsoDate,
  localYesterdayIso,
  renderActivityCategoryFiltersHtml,
  renderActivityDateFilterHtml,
  renderActivityPanelHtml,
  renderActivityPlayersHtml,
  renderActivityServerSelectHtml,
  renderActivityTimelineHtml,
} from '../ui/activity-templates.js';

const POLL_MS = 10_000;

/** @type {Array<{ name: string; displayName?: string; wrapperPort?: number | null }>} */
let serverList = [];
/** @type {string} */
let activeServer = '';
/** @type {string} */
let activeCategory = 'all';
/** @type {string} */
let searchQuery = '';
/** @type {string} */
let activeDay = localIsoDate();
/** @type {string | null} */
let nextCursor = null;
/** @type {boolean} */
let hasMore = false;
/** @type {boolean} */
let loading = false;
/** @type {Array<{ steamId: string; name: string; firstJoinTs: number; serverName: string; carModel: string }>} */
let dayPlayers = [];
/** @type {Array<{ id: string; ts: number; category: string; kind: string; title: string; detail: string; serverName: string }>} */
let timelineItems = [];
/** @type {number | null} */
let pollTimer = null;
/** @type {number} */
let loadSeq = 0;

/**
 * @param {HTMLElement} container
 */
export function mountActivityPanel(container) {
  container.innerHTML = renderActivityPanelHtml();

  document.getElementById('activityCategoryFilters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-activity-category]');
    if (!btn) return;
    activeCategory = btn.dataset.activityCategory || 'all';
    renderCategoryFilters();
    resetTimeline();
    void refreshActivity(false);
  });

  document.getElementById('activityServerSelect')?.addEventListener('change', (e) => {
    const select = e.target;
    if (!(select instanceof HTMLSelectElement)) return;
    activeServer = select.value;
    resetTimeline();
    void refreshActivity(false);
  });

  document.getElementById('activityDateFilter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-activity-day]');
    if (!btn) return;
    const key = btn.dataset.activityDay;
    if (key === 'today') activeDay = localIsoDate();
    else if (key === 'yesterday') activeDay = localYesterdayIso();
    else return;
    renderDateFilter();
    renderSummaryLabel();
    resetTimeline();
    void refreshActivity(false);
  });

  document.getElementById('activityDateFilter')?.addEventListener('change', (e) => {
    const picker = e.target;
    if (!(picker instanceof HTMLInputElement) || picker.id !== 'activityDayPicker') return;
    if (!picker.value) return;
    activeDay = picker.value;
    renderDateFilter();
    renderSummaryLabel();
    resetTimeline();
    void refreshActivity(false);
  });

  const searchEl = document.getElementById('activitySearch');
  let searchDebounce = null;
  searchEl?.addEventListener('input', () => {
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      searchQuery = searchEl instanceof HTMLInputElement ? searchEl.value.trim() : '';
      renderPlayers();
      void refreshActivity(false);
    }, 300);
  });

  document.getElementById('activityLoadMore')?.addEventListener('click', () => {
    if (!hasMore || !nextCursor || loading) return;
    void refreshActivity(true);
  });

  document.getElementById('activityPlayersList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-player-name]');
    if (!row) return;
    const name = row.dataset.playerName;
    if (!name || !searchEl) return;
    searchEl.value = name;
    searchQuery = name;
    renderPlayers();
    resetTimeline();
    void refreshActivity(false);
  });

  document.getElementById('activityPlayersList')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-player-name]');
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  document.addEventListener('visibilitychange', onVisibilityChange);

  renderDateFilter();
  renderSummaryLabel();
  startPoll();
}

function onVisibilityChange() {
  if (document.hidden) {
    stopPoll();
  } else {
    startPoll();
    void refreshActivity(false);
  }
}

function renderServerSelect() {
  const el = document.getElementById('activityServerSelect');
  if (el) el.innerHTML = renderActivityServerSelectHtml(serverList, activeServer);
}

function renderCategoryFilters() {
  const el = document.getElementById('activityCategoryFilters');
  if (el) el.innerHTML = renderActivityCategoryFiltersHtml(activeCategory);
}

function renderDateFilter() {
  const el = document.getElementById('activityDateFilter');
  if (el) el.innerHTML = renderActivityDateFilterHtml(activeDay);
}

function renderSummaryLabel(dayIso = activeDay) {
  const el = document.getElementById('activitySummaryLabel');
  if (el) el.textContent = formatActivitySummaryLabel(dayIso);
}

function resetTimeline() {
  timelineItems = [];
  nextCursor = null;
  hasMore = false;
}

function setStatus(text) {
  const el = document.getElementById('activityStatus');
  if (el) el.textContent = text;
}

function appendDayParams(params) {
  if (activeDay) params.set('day', activeDay);
  params.set('tzOffset', String(browserTzOffsetMinutes()));
}

/** @param {{ playerCount?: number; players?: ActivityPlayerJoin[]; laps?: number; pbs?: number; battles?: number; errors?: number; joins?: number } | undefined} summary */
function renderSummary(summary) {
  const playersEl = document.getElementById('activityPlayers');
  const badge = document.getElementById('activityPlayersBadge');
  const laps = document.getElementById('activityLaps');
  const pbs = document.getElementById('activityPbs');
  const battles = document.getElementById('activityBattles');
  const errors = document.getElementById('activityErrors');
  const count = summary?.playerCount ?? dayPlayers.length;
  if (playersEl) playersEl.textContent = String(count);
  if (badge) badge.textContent = String(count);
  if (laps) laps.textContent = String(summary?.laps ?? 0);
  if (pbs) pbs.textContent = String(summary?.pbs ?? 0);
  if (battles) battles.textContent = String(summary?.battles ?? 0);
  if (errors) errors.textContent = String(summary?.errors ?? 0);
}

function resolveDayPlayers(summaryPlayers, timeline) {
  if (summaryPlayers?.length) return summaryPlayers;
  const fromTimeline = derivePlayersFromTimeline(timeline);
  if (fromTimeline.length) return fromTimeline;
  return [];
}

function renderPlayers() {
  const list = document.getElementById('activityPlayersList');
  const empty = document.getElementById('activityPlayersEmpty');
  if (!list || !empty) return;

  const html = renderActivityPlayersHtml(dayPlayers, !activeServer, searchQuery);
  const hasJoinsInTimeline = timelineItems.some((i) => i.kind === 'join');

  if (!html) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    if (hasJoinsInTimeline && dayPlayers.length === 0) {
      empty.textContent = 'Players list syncing — try refreshing the page.';
    } else {
      empty.textContent = 'No players joined this day.';
    }
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = html;
}

function renderTimeline() {
  const list = document.getElementById('activityTimeline');
  const empty = document.getElementById('activityEmpty');
  const loadMore = document.getElementById('activityLoadMore');

  if (!list || !empty || !loadMore) return;

  if (timelineItems.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    loadMore.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = renderActivityTimelineHtml(timelineItems, !activeServer);

  if (hasMore && nextCursor) {
    loadMore.classList.remove('hidden');
  } else {
    loadMore.classList.add('hidden');
  }
}

function buildQueryParams(includeCursor) {
  const params = new URLSearchParams();
  if (activeServer) params.set('server', activeServer);
  if (activeCategory && activeCategory !== 'all') params.set('category', activeCategory);
  if (searchQuery) params.set('q', searchQuery);
  appendDayParams(params);
  params.set('limit', '50');
  if (includeCursor && nextCursor) params.set('cursor', nextCursor);
  return params.toString();
}

/**
 * @param {boolean} loadMore
 */
async function refreshActivity(loadMore) {
  if (loading) return;
  loading = true;
  const seq = ++loadSeq;

  const list = document.getElementById('activityTimeline');
  const scrollTop = list?.scrollTop ?? 0;
  const atTop = scrollTop < 40;

  try {
    const summaryParams = new URLSearchParams();
    if (activeServer) summaryParams.set('server', activeServer);
    appendDayParams(summaryParams);
    const summaryQuery = summaryParams.toString();
    const timelineParams = buildQueryParams(loadMore);

    const [summaryRes, timelineRes] = await Promise.all([
      apiGet(`/activity/summary${summaryQuery ? `?${summaryQuery}` : ''}`),
      apiGet(`/activity/timeline?${timelineParams}`),
    ]);

    if (seq !== loadSeq) return;

    if (!summaryRes.data.ok || !timelineRes.data.ok) {
      const msg = summaryRes.data.message || timelineRes.data.message || 'Failed to load activity';
      setStatus('Unavailable');
      if (!loadMore) {
        timelineItems = [];
        dayPlayers = [];
        renderTimeline();
        renderPlayers();
      }
      if (summaryRes.res.status === 503 || timelineRes.res.status === 503) {
        setStatus('Redis not configured');
      } else {
        showToast(msg, 'error');
      }
      return;
    }

    const newItems = timelineRes.data.items ?? [];
    if (loadMore) {
      const existing = new Set(timelineItems.map((i) => i.id));
      for (const item of newItems) {
        if (!existing.has(item.id)) timelineItems.push(item);
      }
    } else if (atTop || timelineItems.length === 0) {
      timelineItems = newItems;
    } else {
      const merged = new Map(timelineItems.map((i) => [i.id, i]));
      for (const item of newItems) merged.set(item.id, item);
      timelineItems = [...merged.values()].sort((a, b) => b.ts - a.ts);
    }

    dayPlayers = resolveDayPlayers(summaryRes.data.summary?.players, timelineItems);
    renderSummary(summaryRes.data.summary);
    renderPlayers();

    if (summaryRes.data.summary?.day) {
      activeDay = summaryRes.data.summary.day;
      renderDateFilter();
      renderSummaryLabel(summaryRes.data.summary.day);
    }

    nextCursor = timelineRes.data.nextCursor ?? null;
    hasMore = Boolean(timelineRes.data.hasMore);
    setStatus('Live');

    renderTimeline();

    if (!loadMore && !atTop && list) {
      list.scrollTop = scrollTop;
    }
  } catch (err) {
    if (seq !== loadSeq) return;
    const message = err instanceof Error ? err.message : 'Connection error';
    setStatus(message.includes('404') ? 'API missing — restart ac-data' : 'Error');
    showToast(message, 'error');
  } finally {
    loading = false;
  }
}

export async function loadActivityPanel() {
  setStatus('Loading…');
  resetTimeline();

  try {
    const { data } = await apiGet('/activity/servers');
    if (!data.ok) {
      setStatus(data.message || 'Unavailable');
      if (data.message) showToast(data.message, 'error');
      renderServerSelect();
      renderDateFilter();
      renderSummaryLabel();
      renderCategoryFilters();
      renderTimeline();
      return;
    }

    serverList = data.servers ?? [];
    renderServerSelect();
    renderDateFilter();
    renderSummaryLabel();
    renderCategoryFilters();
    await refreshActivity(false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection error';
    setStatus(message.includes('404') ? 'API missing — restart ac-data' : 'Error');
    showToast(message, 'error');
  }
}

export function unmountActivityPanel() {
  stopPoll();
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

function startPoll() {
  stopPoll();
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void refreshActivity(false);
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}
