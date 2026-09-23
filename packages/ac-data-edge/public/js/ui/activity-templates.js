import { escapeAttr, escapeHtml } from '../lib/dom.js';

/** @typedef {{ steamId: string; name: string; firstJoinTs: number; serverName: string; carModel: string }} ActivityPlayerJoin */

/** @typedef {{ id: string; ts: number; category: string; kind: string; title: string; detail: string; serverName: string }} ActivityItem */

const CATEGORY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'connections', label: 'Connections' },
  { id: 'records', label: 'Records' },
  { id: 'battles', label: 'Battles' },
  { id: 'errors', label: 'Errors' },
  { id: 'sessions', label: 'Sessions' },
];

/** Minutes east of UTC (negated JS getTimezoneOffset). */
export function browserTzOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

export function renderActivityPanelHtml() {
  return `
    <div class="panel activity-panel" id="activityPanel" data-type="activity">
      <div class="panel-header activity-panel-header">
        <div class="activity-panel-heading">
          <h2>Activity</h2>
          <p class="activity-header-note">Live from <code>ac:events</code> · refreshes every 10s</p>
        </div>
        <div class="activity-header-actions">
          <button type="button" class="btn btn-sm btn-ghost activity-refresh-btn" id="activityRefreshBtn" title="Refresh now" aria-label="Refresh activity">↻</button>
          <span class="panel-count" id="activityStatus">Loading…</span>
        </div>
      </div>

      <div class="activity-toolbar">
        <select id="activityServerSelect" class="input activity-server-select" aria-label="Server">
          <option value="">All servers</option>
        </select>
        <input type="search" id="activitySearch" class="search-input activity-search" placeholder="Search name, steamId, track…" autocomplete="off" />
      </div>

      <div id="activityPlayerFilterBar" class="activity-player-filter-bar hidden">
        <button type="button" id="activityBackBtn" class="btn btn-sm btn-ghost activity-back-btn">← Back</button>
        <span class="activity-player-filter-label">Showing activity for <strong id="activityFilterPlayerName"></strong></span>
      </div>

      <div class="activity-date-filter" id="activityDateFilter"></div>

      <div class="activity-summary activity-summary-inline" id="activitySummary">
        <span class="activity-summary-label" id="activitySummaryLabel">Today</span>
        <span class="activity-summary-filtered hidden" id="activitySummaryFiltered">Filtered</span>
        <div class="activity-summary-stats" id="activitySummaryStats">
          <span class="activity-stat activity-stat-filtered hidden" id="activityFilteredEvents"><strong id="activityEventCount">0</strong> events</span>
          <span class="activity-stat"><strong id="activityPlayers">—</strong> players</span>
          <span class="activity-stat"><strong id="activityLaps">—</strong> laps</span>
          <span class="activity-stat"><strong id="activityPbs">—</strong> PBs</span>
          <span class="activity-stat"><strong id="activityBattles">—</strong> battles</span>
          <span class="activity-stat"><strong id="activityErrors">—</strong> errors</span>
        </div>
      </div>

      <div class="activity-body-grid">
        <aside class="activity-players-wrap">
          <div class="activity-players-header">
            <span class="activity-players-title">Players joined</span>
            <span class="activity-players-count" id="activityPlayersBadge">0</span>
          </div>
          <p class="activity-players-note">Unique · first join of the day</p>
          <ul id="activityPlayersList" class="activity-players-list"></ul>
          <p id="activityPlayersEmpty" class="activity-players-empty hidden">No players joined this day.</p>
        </aside>

        <section class="activity-timeline-section">
          <div class="activity-filters">
            <span class="activity-section-label">Timeline</span>
            <div id="activityCategoryFilters" class="activity-filter-row"></div>
          </div>
          <div class="activity-timeline-wrap">
            <ul id="activityTimeline" class="activity-timeline"></ul>
            <p id="activityEmpty" class="activity-empty hidden">No activity yet.</p>
            <button type="button" id="activityLoadMore" class="btn btn-sm activity-load-more hidden">Load more</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

/**
 * @param {Array<{ name: string; displayName?: string; wrapperPort?: number | null }>} servers
 * @param {string} activeServer
 */
export function renderActivityServerSelectHtml(servers, activeServer) {
  let html = `<option value=""${!activeServer ? ' selected' : ''}>All servers</option>`;

  for (const server of servers ?? []) {
    const selected = activeServer === server.name ? ' selected' : '';
    html += `<option value="${escapeAttr(server.name)}"${selected}>${escapeHtml(server.displayName || server.name)}</option>`;
  }
  return html;
}

/** @param {string} activeCategory */
export function renderActivityCategoryFiltersHtml(activeCategory) {
  return CATEGORY_FILTERS.map(
    (cat) =>
      `<button type="button" class="activity-filter-chip${cat.id === activeCategory ? ' active' : ''}" data-activity-category="${escapeAttr(cat.id)}">${escapeHtml(cat.label)}</button>`,
  ).join('');
}

/** @returns {string} YYYY-MM-DD in local timezone */
export function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @returns {string} */
export function localYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localIsoDate(d);
}

/**
 * @param {string} dayIso YYYY-MM-DD
 * @param {string} [todayIso]
 */
export function formatActivitySummaryLabel(dayIso, todayIso = localIsoDate()) {
  if (dayIso === todayIso) return 'Today';
  if (dayIso === localYesterdayIso()) return 'Yesterday';
  const parsed = new Date(`${dayIso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dayIso;
  return parsed.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * @param {string} activeDayIso
 * @param {string} [todayIso]
 */
export function renderActivityDateFilterState(activeDayIso, todayIso = localIsoDate()) {
  const yesterdayIso = localYesterdayIso();
  const isToday = activeDayIso === todayIso;
  const isYesterday = activeDayIso === yesterdayIso;
  return { isToday, isYesterday, pickerValue: activeDayIso };
}

/** @param {string} activeDayIso @param {string} [todayIso] */
export function renderActivityDateFilterHtml(activeDayIso, todayIso = localIsoDate()) {
  const { isToday, isYesterday, pickerValue } = renderActivityDateFilterState(activeDayIso, todayIso);
  const todayClass = isToday ? ' active' : '';
  const yesterdayClass = isYesterday ? ' active' : '';
  return `
    <div class="activity-filter-row">
      <button type="button" class="activity-filter-chip activity-date-chip${todayClass}" data-activity-day="today">Today</button>
      <button type="button" class="activity-filter-chip activity-date-chip${yesterdayClass}" data-activity-day="yesterday">Yesterday</button>
      <input type="date" id="activityDayPicker" class="input activity-day-picker" aria-label="Pick date" value="${escapeAttr(pickerValue)}" />
    </div>
  `;
}

/** @param {number} ts */
export function formatActivityTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** @param {number} ts */
export function formatActivityTooltip(ts) {
  return new Date(ts).toLocaleString();
}

/** @param {string} name */
function playerInitial(name) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

/** @param {ActivityItem} item */
function kindBadge(item) {
  if (item.kind === 'join') return '<span class="activity-badge activity-badge-join">+</span>';
  if (item.kind === 'leave') return '<span class="activity-badge activity-badge-leave">−</span>';
  if (item.kind === 'pb') return '<span class="activity-badge activity-badge-pb">PB</span>';
  if (item.category === 'errors') return '<span class="activity-badge activity-badge-error">!</span>';
  if (item.category === 'battles') return '<span class="activity-badge activity-badge-battle">⚔</span>';
  return '';
}

/**
 * @param {ActivityItem} item
 * @param {boolean} [showServer]
 */
export function renderActivityTimelineItemHtml(item, showServer = false) {
  const time = formatActivityTime(item.ts);
  const tooltip = escapeAttr(formatActivityTooltip(item.ts));
  const detail = item.detail ? `<span class="activity-item-detail">${escapeHtml(item.detail)}</span>` : '';
  const server =
    showServer && item.serverName
      ? `<span class="activity-item-server">${escapeHtml(item.serverName)}</span>`
      : '';
  const connectionClass =
    item.category === 'connections' ? ` activity-item-kind-${escapeAttr(item.kind)}` : '';

  return `
    <li class="activity-item activity-item-${escapeAttr(item.category)}${connectionClass}" data-activity-id="${escapeAttr(item.id)}">
      <time class="activity-item-time" datetime="${escapeAttr(String(item.ts))}" title="${tooltip}">${escapeHtml(time)}</time>
      <div class="activity-item-body">
        ${server}
        <div class="activity-item-title">${kindBadge(item)}${escapeHtml(item.title)}</div>
        ${detail}
      </div>
    </li>
  `;
}

/**
 * @param {ActivityItem[]} items
 * @param {boolean} [showServer]
 */
export function renderActivityTimelineHtml(items, showServer = false) {
  if (!items?.length) return '';
  return items.map((item) => renderActivityTimelineItemHtml(item, showServer)).join('');
}

/**
 * @param {ActivityPlayerJoin[]} players
 * @param {boolean} [showServer]
 * @param {string} [searchQuery]
 */
export function renderActivityPlayersHtml(players, showServer = false, searchQuery = '') {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? players.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.steamId.toLowerCase().includes(q) ||
          p.carModel.toLowerCase().includes(q) ||
          p.serverName.toLowerCase().includes(q),
      )
    : players;

  if (!filtered.length) return '';

  return filtered
    .map((player) => {
      const time = formatActivityTime(player.firstJoinTs);
      const tooltip = escapeAttr(formatActivityTooltip(player.firstJoinTs));
      const metaParts = [player.carModel];
      if (showServer && player.serverName) metaParts.push(player.serverName);
      const meta = metaParts.filter(Boolean).join(' · ');
      const initial = escapeHtml(playerInitial(player.name));
      const isActive = q && player.name.toLowerCase() === q;
      return `
    <li class="activity-player-item${isActive ? ' is-active' : ''}" data-player-name="${escapeAttr(player.name)}" role="button" tabindex="0" title="Filter timeline by ${escapeAttr(player.name)}">
      <span class="activity-player-avatar" aria-hidden="true">${initial}</span>
      <time class="activity-player-time" datetime="${escapeAttr(String(player.firstJoinTs))}" title="${tooltip}">${escapeHtml(time)}</time>
      <div class="activity-player-body">
        <span class="activity-player-name">${escapeHtml(player.name)}</span>
        ${meta ? `<span class="activity-player-meta">${escapeHtml(meta)}</span>` : ''}
        ${player.steamId ? `<span class="activity-player-steam">${escapeHtml(player.steamId)}</span>` : ''}
      </div>
    </li>`;
    })
    .join('');
}

/**
 * Derive unique players from timeline join items (client-side fallback).
 * @param {ActivityItem[]} items
 * @returns {ActivityPlayerJoin[]}
 */
export function derivePlayersFromTimeline(items) {
  /** @type {Map<string, ActivityPlayerJoin>} */
  const map = new Map();

  for (const item of items) {
    if (item.kind !== 'join') continue;
    const match = item.title.match(/^(.+?) joined /);
    const name = match?.[1]?.trim() || 'Player';
    const steamMatch = item.detail.match(/\b(765611\d{11})\b/);
    const steamId = steamMatch?.[1] ?? '';
    const key = steamId || `name:${name.toLowerCase()}`;
    const carModel = item.detail.split(' · ')[0]?.trim() ?? '';
    const candidate = {
      steamId,
      name,
      firstJoinTs: item.ts,
      serverName: item.serverName,
      carModel,
    };
    const existing = map.get(key);
    if (!existing || item.ts < existing.firstJoinTs) {
      map.set(key, candidate);
    }
  }

  return [...map.values()].sort((a, b) => b.firstJoinTs - a.firstJoinTs);
}

/** @param {number} [count] */
export function renderActivityTimelineSkeleton(count = 6) {
  let html = '';
  for (let i = 0; i < count; i += 1) {
    html += `
    <li class="activity-skeleton-item activity-skeleton-timeline" aria-hidden="true">
      <span class="activity-skeleton-time skeleton-row"></span>
      <div class="activity-skeleton-body">
        <span class="skeleton-row activity-skeleton-line"></span>
        <span class="skeleton-row activity-skeleton-line activity-skeleton-line-short"></span>
      </div>
    </li>`;
  }
  return html;
}

/** @param {number} [count] */
export function renderActivityPlayersSkeleton(count = 4) {
  let html = '';
  for (let i = 0; i < count; i += 1) {
    html += `
    <li class="activity-skeleton-item activity-skeleton-player" aria-hidden="true">
      <span class="activity-skeleton-avatar skeleton-row"></span>
      <span class="activity-skeleton-time skeleton-row"></span>
      <div class="activity-skeleton-body">
        <span class="skeleton-row activity-skeleton-line"></span>
        <span class="skeleton-row activity-skeleton-line activity-skeleton-line-short"></span>
      </div>
    </li>`;
  }
  return html;
}
