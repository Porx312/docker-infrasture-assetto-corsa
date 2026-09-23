import { normalizeHudServerName } from '../hud/hudQueryNormalize.js';
import { summarizeServers } from '../serverBranding.js';
import { formatLapMs, formatTrackLabel } from './activityFormat.js';
import type {
  ActivityCategory,
  ActivityItem,
  ActivityKind,
  ActivityPlayerJoin,
  ParsedStreamEntry,
} from './activityTypes.js';

const SKIPPED_EVENTS = new Set(['battle_update', 'server_config_snapshot', 'server_config_applied']);

function playerName(data: Record<string, unknown>): string {
  const name = data.name ?? data.player1Name ?? data.player2Name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Player';
}

function steamId(data: Record<string, unknown>): string {
  return typeof data.steamId === 'string' ? data.steamId.trim() : '';
}

function isPersonalBest(data: Record<string, unknown>): boolean {
  const raw = data.isPersonalBest;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return false;
}

function buildSearchText(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function normalizeJoin(entry: ParsedStreamEntry, data: Record<string, unknown>): ActivityItem {
  const name = playerName(data);
  const server = entry.serverName;
  const track = formatTrackLabel(data.trackName, data.trackConfig);
  const car = typeof data.carModel === 'string' ? data.carModel : '';
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'connections',
    kind: 'join',
    title: `${name} joined ${server}`,
    detail: [car, track].filter(Boolean).join(' · '),
    serverName: server,
    searchText: buildSearchText([name, steamId(data), server, car, track]),
  };
}

function resolveLeaveName(
  data: Record<string, unknown>,
  joinNames?: Map<string, string>,
): string {
  let name = playerName(data);
  const sid = steamId(data);
  if (name === 'Player' && sid && joinNames?.has(sid)) {
    name = joinNames.get(sid)!;
  }
  return name;
}

function normalizeLeave(
  entry: ParsedStreamEntry,
  data: Record<string, unknown>,
  joinNames?: Map<string, string>,
): ActivityItem {
  const server = entry.serverName;
  const name = resolveLeaveName(data, joinNames);
  const track = formatTrackLabel(data.trackName, data.trackConfig);
  const sid = steamId(data);
  const reason = typeof data.reason === 'string' ? data.reason : '';
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'connections',
    kind: 'leave',
    title: `${name} left ${server}`,
    detail: [sid, track, reason].filter(Boolean).join(' · '),
    serverName: server,
    searchText: buildSearchText([name, sid, server, track, reason]),
  };
}

function normalizeLap(entry: ParsedStreamEntry, data: Record<string, unknown>): ActivityItem {
  const pb = isPersonalBest(data);
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Driver';
  const lapMs = typeof data.lapTime === 'number' ? data.lapTime : Number(data.lapTime);
  const track = formatTrackLabel(data.trackName, data.trackConfig);
  const timeLabel = formatLapMs(lapMs);
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'records',
    kind: pb ? 'pb' : 'lap',
    title: pb ? `${name} set a new PB` : `${name} completed a lap`,
    detail: [track, timeLabel].filter(Boolean).join(' · '),
    serverName: entry.serverName,
    searchText: buildSearchText([name, steamId(data), entry.serverName, track, timeLabel]),
  };
}

function normalizeBattle(entry: ParsedStreamEntry, data: Record<string, unknown>): ActivityItem {
  const p1 = typeof data.player1Name === 'string' ? data.player1Name : 'P1';
  const p2 = typeof data.player2Name === 'string' ? data.player2Name : 'P2';
  const s1 = typeof data.player1Score === 'number' ? data.player1Score : 0;
  const s2 = typeof data.player2Score === 'number' ? data.player2Score : 0;
  const winnerId = typeof data.winnerSteamId === 'string' ? data.winnerSteamId : '';
  const status = typeof data.status === 'string' ? data.status : 'finished';
  let winnerLabel = 'Draw';
  if (winnerId) {
    if (winnerId === data.player1SteamId) winnerLabel = p1;
    else if (winnerId === data.player2SteamId) winnerLabel = p2;
    else winnerLabel = 'Winner';
  }
  const track = formatTrackLabel(data.track, data.trackConfig);
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'battles',
    kind: 'battle',
    title: status === 'draw' ? `Battle ended in a draw` : `Battle finished — ${winnerLabel} wins`,
    detail: [`${p1} ${s1}-${s2} ${p2}`, track].filter(Boolean).join(' · '),
    serverName: entry.serverName,
    searchText: buildSearchText([p1, p2, entry.serverName, track, winnerLabel]),
  };
}

function normalizeWorkerError(entry: ParsedStreamEntry, data: Record<string, unknown>): ActivityItem {
  const error = typeof data.error === 'string' ? data.error : 'Worker error';
  const failed = typeof data.failed === 'number' ? data.failed : undefined;
  const detailParts = [failed != null ? `${failed} events` : '', error].filter(Boolean);
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'errors',
    kind: 'error',
    title: 'Convex ingest failed',
    detail: detailParts.join(' · '),
    serverName: entry.serverName || 'worker',
    searchText: buildSearchText([error, entry.serverName, String(failed)]),
  };
}

function normalizeSession(entry: ParsedStreamEntry, data: Record<string, unknown>, playerCount: number): ActivityItem {
  return {
    id: entry.streamId,
    ts: entry.ts,
    category: 'sessions',
    kind: 'session',
    title: `${playerCount} player${playerCount === 1 ? '' : 's'} online`,
    detail: formatTrackLabel(data.trackName, data.trackConfig),
    serverName: entry.serverName,
    searchText: buildSearchText([entry.serverName, String(playerCount)]),
  };
}

export function shouldSkipRawEvent(event: string): boolean {
  return SKIPPED_EVENTS.has(event);
}

/** Build steamId → display name from player_join entries (for enriching leaves). */
export function buildJoinNameIndex(entries: ParsedStreamEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.event !== 'player_join') continue;
    const data = entry.payload.data ?? {};
    const sid = steamId(data);
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '';
    if (sid && name && !sid.startsWith('unknown_')) {
      map.set(sid, name);
    }
  }
  return map;
}

export function normalizeStreamEntry(
  entry: ParsedStreamEntry,
  joinNames?: Map<string, string>,
): ActivityItem | null {
  const event = entry.event;
  const data = entry.payload.data ?? {};

  if (shouldSkipRawEvent(event)) {
    return null;
  }

  switch (event) {
    case 'player_join':
      return normalizeJoin(entry, data);
    case 'player_leave':
      return normalizeLeave(entry, data, joinNames);
    case 'lap_completed':
      return normalizeLap(entry, data);
    case 'battle_finished':
      return normalizeBattle(entry, data);
    case 'worker_error':
      return normalizeWorkerError(entry, data);
    default:
      return null;
  }
}

/** Dedupe server_status to player-count changes only. */
export function normalizeSessionEntries(entries: ParsedStreamEntry[]): ActivityItem[] {
  const byServer = new Map<string, number>();
  const items: ActivityItem[] = [];

  for (const entry of entries) {
    if (entry.event !== 'server_status') continue;
    const data = entry.payload.data ?? {};
    const players = Array.isArray(data.players) ? data.players : [];
    const count = players.length;
    const key = normalizeHudServerName(entry.serverName).toLowerCase();
    const prev = byServer.get(key);
    if (prev === count) continue;
    byServer.set(key, count);
    items.push(normalizeSession(entry, data, count));
  }

  return items;
}

export function matchesCategory(item: ActivityItem, category: ActivityCategory | 'all' | undefined): boolean {
  if (!category || category === 'all') {
    return item.category !== 'sessions';
  }
  return item.category === category;
}

function serverFilterNeedles(serverFilter: string): string[] {
  const trimmed = serverFilter.trim();
  if (!trimmed) return [];

  const needles = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value?.trim()) return;
    needles.add(normalizeHudServerName(value).toLowerCase());
  };

  add(trimmed);
  for (const row of summarizeServers()) {
    if (row.name === trimmed || row.displayName === trimmed) {
      add(row.name);
      add(row.displayName);
    }
  }
  return [...needles];
}

export function matchesServer(item: ActivityItem, serverFilter: string | undefined): boolean {
  if (!serverFilter?.trim()) return true;
  const hay = normalizeHudServerName(item.serverName).toLowerCase();
  for (const needle of serverFilterNeedles(serverFilter)) {
    if (hay === needle || hay.includes(needle) || needle.includes(hay)) return true;
  }
  return false;
}

export function matchesSearch(item: ActivityItem, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  return item.searchText.includes(q.trim().toLowerCase());
}

export function matchesPlayerJoin(player: ActivityPlayerJoin, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    player.name.toLowerCase().includes(needle) ||
    player.steamId.toLowerCase().includes(needle) ||
    player.carModel.toLowerCase().includes(needle) ||
    player.serverName.toLowerCase().includes(needle)
  );
}

export function playerJoinSearchText(player: ActivityPlayerJoin): string {
  return [player.name, player.steamId, player.carModel, player.serverName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function categoryForSummary(item: ActivityItem): ActivityCategory | null {
  return item.category;
}

export function playerJoinDedupeKey(
  data: Record<string, unknown>,
  entry: ParsedStreamEntry,
): string {
  const sid = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  if (sid && !sid.startsWith('unknown_')) return sid;
  const name = typeof data.name === 'string' ? data.name.trim().toLowerCase() : '';
  if (name) return `name:${name}`;
  return `event:${entry.streamId}`;
}

export function upsertUniquePlayerJoin(
  map: Map<string, ActivityPlayerJoin>,
  entry: ParsedStreamEntry,
  data: Record<string, unknown>,
): void {
  const key = playerJoinDedupeKey(data, entry);
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Player';
  const steamId = typeof data.steamId === 'string' ? data.steamId.trim() : '';
  const carModel = typeof data.carModel === 'string' ? data.carModel.trim() : '';
  const candidate: ActivityPlayerJoin = {
    steamId,
    name,
    firstJoinTs: entry.ts,
    serverName: entry.serverName,
    carModel,
  };
  const existing = map.get(key);
  if (!existing || entry.ts < existing.firstJoinTs) {
    map.set(key, candidate);
  }
}
