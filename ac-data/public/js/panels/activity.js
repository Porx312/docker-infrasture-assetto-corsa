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
  renderActivityPlayersSkeleton,
  renderActivityServerSelectHtml,
  renderActivityTimelineHtml,
  renderActivityTimelineSkeleton,
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
/** @type {boolean} */
let uiLoading = false;
/** @type {number | null} */
let slowLoadTimer = null;
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
      updateFilterBackButton();
      resetTimeline();
      void refreshActivity(false);
    }, 300);
  });

  document.getElementById('activityRefreshBtn')?.addEventListener('click', () => {
    if (loading) return;
    void refreshActivity(false);
  });

  document.getElementById('activityLoadMore')?.addEventListener('click', () => {
    if (!hasMore || !nextCursor || loading) return;
    void refreshActivity(true);
  });

  document.getElementById('activityBackBtn')?.addEventListener('click', () => {
    clearActivityFilter();
  });

  document.getElementById('activityPlayersList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-player-name]');
    if (!row) return;
    const name = row.dataset.playerName;
    if (!name || !searchEl) return;
    searchEl.value = name;
    searchQuery = name;
    updateFilterBackButton();
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
  renderCategoryFilters();
  startPoll();
}

function onVisibilityChange() {
  if (document.hidden) {
    stopPoll();
  } else {
    startPoll();
    void refreshActivity(false, { background: true });
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

function updateFilterBackButton() {
  const bar = document.getElementById('activityPlayerFilterBar');
  const nameEl = document.getElementById('activityFilterPlayerName');
  const query = searchQuery.trim();
  bar?.classList.toggle('hidden', !query);
  if (nameEl) nameEl.textContent = query;
}

function clearActivityFilter() {
  searchQuery = '';
  const searchEl = document.getElementById('activitySearch');
  if (searchEl instanceof HTMLInputElement) searchEl.value = '';
  updateFilterBackButton();
  resetTimeline();
  void refreshActivity(false);
}

/**
 * @param {boolean} isLoading
 * @param {string} [message]
 * @param {{ showSkeleton?: boolean }} [options]
 */
function setActivityLoading(isLoading, message = 'Loading…', options = {}) {
  const { showSkeleton = false } = options;
  uiLoading = isLoading;
  document.getElementById('activityPanel')?.classList.toggle('is-loading', isLoading);

  if (isLoading) {
    setStatus(message);
    if (showSkeleton) showActivitySkeletons();
    window.clearTimeout(slowLoadTimer);
    slowLoadTimer = window.setTimeout(() => {
      if (uiLoading) setStatus('Still loading… (Redis scan)');
    }, 3000);
  } else {
    window.clearTimeout(slowLoadTimer);
    slowLoadTimer = null;
  }
}

function showActivitySkeletons() {
  const timeline = document.getElementById('activityTimeline');
  const players = document.getElementById('activityPlayersList');
  document.getElementById('activityEmpty')?.classList.add('hidden');
  document.getElementById('activityPlayersEmpty')?.classList.add('hidden');
  document.getElementById('activityLoadMore')?.classList.add('hidden');
  if (timeline) timeline.innerHTML = renderActivityTimelineSkeleton();
  if (players) players.innerHTML = renderActivityPlayersSkeleton();

  for (const id of ['activityPlayers', 'activityLaps', 'activityPbs', 'activityBattles', 'activityErrors']) {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  }
  const badge = document.getElementById('activityPlayersBadge');
  if (badge) badge.textContent = '…';
}

function appendDayParams(params) {
  if (activeDay) params.set('day', activeDay);
  params.set('tzOffset', String(browserTzOffsetMinutes()));
}

/** @param {{ playerCount?: number; players?: ActivityPlayerJoin[]; laps?: number; pbs?: number; battles?: number; errors?: number; filtered?: boolean; timelineEventCount?: number } | undefined} summary */
function renderSummary(summary) {
  const summaryEl = document.getElementById('activitySummary');
  const filteredBadge = document.getElementById('activitySummaryFiltered');
  const filteredEvents = document.getElementById('activityFilteredEvents');
  const eventCount = document.getElementById('activityEventCount');
  const playersEl = document.getElementById('activityPlayers');
  const badge = document.getElementById('activityPlayersBadge');
  const laps = document.getElementById('activityLaps');
  const pbs = document.getElementById('activityPbs');
  const battles = document.getElementById('activityBattles');
  const errors = document.getElementById('activityErrors');

  const isFiltered = Boolean(summary?.filtered && searchQuery);
  summaryEl?.classList.toggle('activity-summary-filtered-mode', isFiltered);
  filteredBadge?.classList.toggle('hidden', !isFiltered);
  filteredEvents?.classList.toggle('hidden', !isFiltered);

  const count = summary?.playerCount ?? dayPlayers.length;
  if (playersEl) playersEl.textContent = String(count);
  if (badge) badge.textContent = String(count);
  if (laps) laps.textContent = String(summary?.laps ?? 0);
  if (pbs) pbs.textContent = String(summary?.pbs ?? 0);
  if (battles) battles.textContent = String(summary?.battles ?? 0);
  if (errors) errors.textContent = String(summary?.errors ?? 0);
  if (eventCount) {
    eventCount.textContent = String(summary?.timelineEventCount ?? timelineItems.length);
  }
  updateFilterBackButton();
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
    if (uiLoading) {
      empty.classList.add('hidden');
      return;
    }
    empty.classList.remove('hidden');
    if (hasJoinsInTimeline && dayPlayers.length === 0) {
      empty.textContent = 'Players list syncing — try refreshing the page.';
    } else if (searchQuery) {
      empty.textContent = 'No players match your search.';
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
    if (uiLoading) {
      empty.classList.add('hidden');
      return;
    }
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

function buildFeedQueryParams(includeCursor) {
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
 * @param {{ background?: boolean; skipUiStart?: boolean; statusMessage?: string }} [options]
 */
async function refreshActivity(loadMore, options = {}) {
  const { background = false, skipUiStart = false, statusMessage = 'Updating…' } = options;
  if (loading) return;
  loading = true;
  const seq = ++loadSeq;

  const list = document.getElementById('activityTimeline');
  const scrollTop = list?.scrollTop ?? 0;
  const atTop = scrollTop < 40;

  const refreshBtn = document.getElementById('activityRefreshBtn');
  const loadMoreBtn = document.getElementById('activityLoadMore');

  if (loadMore) {
    if (loadMoreBtn instanceof HTMLButtonElement) {
      loadMoreBtn.textContent = 'Loading…';
      loadMoreBtn.disabled = true;
    }
  } else if (!background && !skipUiStart) {
    setActivityLoading(true, statusMessage, { showSkeleton: true });
  }

  refreshBtn?.setAttribute('disabled', 'true');

  try {
    const feedQuery = buildFeedQueryParams(loadMore);
    const feedRes = await apiGet(`/activity/feed?${feedQuery}`);

    if (seq !== loadSeq) return;

    if (!feedRes.data.ok) {
      const msg = feedRes.data.message || 'Failed to load activity';
      setStatus('Unavailable');
      if (!loadMore) {
        timelineItems = [];
        dayPlayers = [];
        if (!background) setActivityLoading(false);
        renderTimeline();
        renderPlayers();
      }
      if (feedRes.res.status === 503) {
        setStatus('Redis not configured');
      } else {
        showToast(msg, 'error');
      }
      return;
    }

    const newItems = feedRes.data.items ?? [];
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

    dayPlayers = resolveDayPlayers(feedRes.data.summary?.players, timelineItems);
    renderSummary(feedRes.data.summary);
    renderPlayers();

    if (feedRes.data.summary?.day) {
      activeDay = feedRes.data.summary.day;
      renderDateFilter();
      renderSummaryLabel(feedRes.data.summary.day);
    }

    nextCursor = feedRes.data.nextCursor ?? null;
    hasMore = Boolean(feedRes.data.hasMore);
    if (!background) setActivityLoading(false);
    setStatus('Live');

    renderTimeline();

    if (!loadMore && !atTop && list) {
      list.scrollTop = scrollTop;
    }
  } catch (err) {
    if (seq !== loadSeq) return;
    const message = err instanceof Error ? err.message : 'Connection error';
    if (!loadMore && !background) setActivityLoading(false);
    setStatus(message.includes('404') ? 'API missing — restart ac-data' : 'Error');
    showToast(message, 'error');
  } finally {
    loading = false;
    refreshBtn?.removeAttribute('disabled');
    if (loadMore && loadMoreBtn instanceof HTMLButtonElement) {
      loadMoreBtn.textContent = 'Load more';
      loadMoreBtn.disabled = false;
    }
  }
}

export async function loadActivityPanel() {
  resetTimeline();
  const needsServers = serverList.length === 0;
  setActivityLoading(true, needsServers ? 'Loading servers…' : 'Loading activity…', {
    showSkeleton: true,
  });

  try {
    if (needsServers) {
      const { data } = await apiGet('/activity/servers');
      if (!data.ok) {
        setActivityLoading(false);
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
    }

    renderServerSelect();
    renderDateFilter();
    renderSummaryLabel();
    renderCategoryFilters();

    setStatus('Scanning events…');
    await refreshActivity(false, { skipUiStart: true, statusMessage: 'Scanning events…' });
  } catch (err) {
    setActivityLoading(false);
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
    if (!document.hidden) void refreshActivity(false, { background: true });
  }, POLL_MS);
}

function stopPoll() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}
