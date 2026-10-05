import { apiGet, apiPost, apiPatch } from '../lib/api.js';
import { escapeAttr, escapeHtml } from '../lib/dom.js';
import { distNeedsPolling, renderModSyncStatusCell } from '../lib/modSyncStatus.js';
import { showConfirm } from '../lib/modal.js';
import { showToast } from '../lib/toast.js';

/** @type {ReturnType<typeof setInterval> | null} */
let fleetOpsPollTimer = null;

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)} MB`;
  return `${num} B`;
}

/**
 * @param {number | string | null | undefined} used
 * @param {number | string | null | undefined} total
 */
function usageBarHtml(used, total) {
  const t = Number(total);
  const u = Number(used);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(u)) {
    return '<div class="fleet-capacity-bar fleet-capacity-bar-empty"></div>';
  }
  const pct = Math.max(0, Math.min(100, Math.round((u / t) * 100)));
  const tone = pct >= 90 ? 'is-critical' : pct >= 75 ? 'is-warn' : '';
  return `<div class="fleet-capacity-bar ${tone}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="fleet-capacity-bar-fill" style="width:${pct}%"></div>
  </div>`;
}

/**
 * @param {object} edge
 */
function renderCapacityCard(edge) {
  const cap = edge.capacity;
  const memTotal = Number(edge.mem_total_bytes);
  const memFree = Number(edge.mem_free_bytes);
  const memUsed = Number.isFinite(memTotal) && Number.isFinite(memFree) ? memTotal - memFree : NaN;
  const diskTotal = Number(edge.disk_total_bytes);
  const diskFree = Number(edge.disk_free_bytes);
  const diskUsed =
    Number.isFinite(diskTotal) && Number.isFinite(diskFree) ? diskTotal - diskFree : NaN;
  const cpuCount = edge.cpu_count != null ? Number(edge.cpu_count) : NaN;
  const load1 = edge.load1 != null ? Number(edge.load1) : NaN;
  const serversRunning = edge.servers_running != null ? Number(edge.servers_running) : null;
  const serversTotal = edge.servers_total != null ? Number(edge.servers_total) : null;
  const processes = Array.isArray(edge.processes) ? edge.processes : [];
  const observedRss = processes
    .filter((p) => p.kind === 'acServer' || p.kind === 'cm-proxy')
    .reduce((sum, p) => sum + (Number(p.rssBytes) || 0), 0);
  const extra = cap?.serversExtraEstimate;
  const badge =
    processes.length === 0 && extra == null
      ? '<span class="badge badge-muted">No metrics yet</span>'
      : extra != null
        ? `<span class="badge badge-muted" title="Heuristic from EDGE_CAPACITY_* env">~+${extra} room</span>`
        : '';

  const serversLabel =
    serversRunning != null && serversTotal != null
      ? `${serversRunning} / ${serversTotal}`
      : '—';
  const cpuLabel =
    Number.isFinite(load1) && Number.isFinite(cpuCount)
      ? `${load1.toFixed(2)} / ${cpuCount} cores`
      : '—';
  const ramLabel =
    Number.isFinite(memFree) && Number.isFinite(memTotal)
      ? `${formatBytes(memFree)} free · ${formatBytes(memTotal)}`
      : '—';
  const diskLabel =
    Number.isFinite(diskFree) && Number.isFinite(diskTotal)
      ? `${formatBytes(diskFree)} free · ${formatBytes(diskTotal)}`
      : Number.isFinite(diskFree)
        ? `${formatBytes(diskFree)} free`
        : '—';

  const processRows =
    processes.length === 0
      ? `<tr><td colspan="4" class="panel-hint">No AC processes reported yet</td></tr>`
      : processes
          .map((p) => {
            const cpu =
              p.cpuPct == null || !Number.isFinite(Number(p.cpuPct))
                ? '—'
                : `${Number(p.cpuPct).toFixed(1)}%`;
            return `<tr>
              <td title="${escapeAttr(p.cmdline || p.name)}">${escapeHtml(p.name)}</td>
              <td class="num">${escapeHtml(String(p.pid))}</td>
              <td class="num">${escapeHtml(formatBytes(p.rssBytes))}</td>
              <td class="num">${escapeHtml(cpu)}</td>
            </tr>`;
          })
          .join('');

  const observedLabel =
    processes.length > 0
      ? `<p class="fleet-process-observed">Observed RSS (AC + proxy): <strong>${escapeHtml(formatBytes(observedRss))}</strong></p>`
      : '';

  return `
    <article class="fleet-capacity-card">
      <header class="fleet-capacity-card-head">
        <div>
          <h4>${escapeHtml(edge.label || edge.id)}</h4>
          <code class="fleet-capacity-edge-id">${escapeHtml(edge.id)}</code>
        </div>
        ${badge}
      </header>
      <dl class="fleet-capacity-stats">
        <div>
          <dt>Servers</dt>
          <dd>${escapeHtml(serversLabel)} <span class="panel-hint">running / folders</span></dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>${escapeHtml(cpuLabel)}</dd>
          ${usageBarHtml(Number.isFinite(load1) ? load1 : null, Number.isFinite(cpuCount) ? cpuCount : null)}
        </div>
        <div>
          <dt>RAM</dt>
          <dd>${escapeHtml(ramLabel)}</dd>
          ${usageBarHtml(memUsed, memTotal)}
        </div>
        <div>
          <dt>Disk</dt>
          <dd>${escapeHtml(diskLabel)}</dd>
          ${usageBarHtml(diskUsed, diskTotal)}
        </div>
      </dl>
      <div class="fleet-process-block">
        <h5 class="fleet-process-heading">Processes</h5>
        ${observedLabel}
        <div class="fleet-process-table-wrap">
          <table class="fleet-process-table">
            <thead>
              <tr>
                <th>Name</th>
                <th class="num">PID</th>
                <th class="num">RSS</th>
                <th class="num">CPU%</th>
              </tr>
            </thead>
            <tbody>${processRows}</tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function stopFleetOpsPoll() {
  if (fleetOpsPollTimer != null) {
    clearInterval(fleetOpsPollTimer);
    fleetOpsPollTimer = null;
  }
}

function formatLastSeen(iso) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const agoSec = Math.round((Date.now() - t) / 1000);
  if (agoSec < 60) return `${agoSec}s ago`;
  if (agoSec < 3600) return `${Math.round(agoSec / 60)}m ago`;
  if (agoSec < 86400) return `${Math.round(agoSec / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function edgeHealthClass(lastSeenAt) {
  if (!lastSeenAt) return 'edge-stale';
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 120_000) return 'edge-stale';
  return 'edge-ok';
}

/** @param {HTMLElement} root */
export function mountModDistributionPanel(root) {
  stopFleetOpsPoll();
  root.innerHTML = `
    <section class="panel-section fleet-ops-panel">
      <header class="panel-header">
        <div>
          <h2>Fleet</h2>
          <p class="panel-hint">Agent health, capacity, stuck syncs, and disk GC. Upload and per-VPS inventory live in Cars / Tracks.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="fleetOpsRefreshBtn">Refresh</button>
      </header>
      <div id="fleetOpsEdges" class="mod-dist-edges card"></div>
      <div id="fleetOpsCapacity" class="fleet-ops-section card"></div>
      <div id="fleetOpsSyncIssues" class="fleet-ops-section card"></div>
      <div id="fleetOpsGc" class="fleet-ops-section card"></div>
    </section>
  `;

  root.querySelector('#fleetOpsRefreshBtn')?.addEventListener('click', () => {
    void loadModDistributionPanel(root);
  });
}

/** Alias used by dashboard after rename */
export const mountFleetDeployPanel = mountModDistributionPanel;

/** @param {HTMLElement} root */
export async function loadModDistributionPanel(root) {
  if (!root.querySelector('#fleetOpsEdges')) {
    mountModDistributionPanel(root);
  }
  await Promise.all([loadEdgesSection(root), loadSyncIssuesSection(root), loadGcSection(root)]);
  startFleetOpsPoll(root);
}

export const loadFleetDeployPanel = loadModDistributionPanel;

/** @param {HTMLElement} root */
function startFleetOpsPoll(root) {
  stopFleetOpsPoll();
  fleetOpsPollTimer = setInterval(() => {
    if (!document.body.contains(root)) {
      stopFleetOpsPoll();
      return;
    }
    void loadEdgesSection(root);
    void loadSyncIssuesSection(root);
  }, 5000);
}

/** @param {HTMLElement} root */
async function loadEdgesSection(root) {
  const el = root.querySelector('#fleetOpsEdges');
  if (!el) return;
  const { data } = await apiGet('/mods/edges');
  if (!data.ok) {
    el.innerHTML = `<p class="panel-hint">${escapeHtml(data.message || 'Edges unavailable')}</p>`;
    renderCapacitySection(root, []);
    return;
  }
  const edges = data.edges || [];
  if (!edges.length) {
    el.innerHTML =
      '<p class="panel-hint">No fleet edges in DB yet — set FLEET_EDGE_REGISTRY or wait for agent heartbeat.</p>';
    renderCapacitySection(root, []);
    return;
  }
  el.innerHTML = `
    <h3>VPS edges</h3>
    <p class="panel-hint">Disable an edge to pause new sync jobs. PENDING stuck? Agent offline or wrong EDGE_ID.</p>
    <table class="mod-dist-table">
      <thead>
        <tr>
          <th>EDGE_ID</th>
          <th>Label</th>
          <th>Status</th>
          <th>Last seen</th>
          <th>Disk free</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${edges
          .map((e) => {
            const stale = edgeHealthClass(e.last_seen_at);
            const enabled = e.enabled !== false;
            return `<tr class="${stale}" data-edge-id="${escapeAttr(e.id)}">
              <td><code>${escapeHtml(e.id)}</code></td>
              <td>${escapeHtml(e.label || e.id)}</td>
              <td>
                <span class="badge ${stale === 'edge-ok' ? 'badge-ok' : 'badge-warn'}">
                  ${stale === 'edge-ok' ? 'Online' : 'Stale'}
                </span>
                ${enabled ? '' : ' <span class="badge badge-muted">Disabled</span>'}
              </td>
              <td>${formatLastSeen(e.last_seen_at)}</td>
              <td>${e.disk_free_bytes != null ? formatBytes(e.disk_free_bytes) : '—'}</td>
              <td>
                <button type="button" class="btn btn-sm ${enabled ? 'btn-ghost' : 'btn-primary'}" data-edge-toggle="${escapeAttr(e.id)}" data-enabled="${enabled ? '1' : '0'}">
                  ${enabled ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;

  el.querySelectorAll('[data-edge-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const edgeId = /** @type {HTMLElement} */ (btn).getAttribute('data-edge-toggle');
      const currentlyEnabled = /** @type {HTMLElement} */ (btn).getAttribute('data-enabled') === '1';
      if (!edgeId) return;
      const next = !currentlyEnabled;
      const { res, data: patchData } = await apiPatch(`/mods/edges/${encodeURIComponent(edgeId)}`, {
        enabled: next,
      });
      if (!res.ok || !patchData.ok) {
        showToast(patchData.message || 'Could not update edge', 'error');
        return;
      }
      showToast(next ? `Enabled ${edgeId}` : `Disabled ${edgeId}`, 'success');
      await loadEdgesSection(root);
    });
  });

  renderCapacitySection(root, edges);
}

/**
 * @param {HTMLElement} root
 * @param {object[]} edges
 */
function renderCapacitySection(root, edges) {
  const el = root.querySelector('#fleetOpsCapacity');
  if (!el) return;
  if (!edges.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <h3>Capacity</h3>
    <p class="panel-hint">Procesos reales (RSS / CPU%) por VPS. Usa la suma de RSS para estimar cuánto cabe; el hint ~+N room es solo heurística de env.</p>
    <div class="fleet-capacity-grid">
      ${edges.map((e) => renderCapacityCard(e)).join('')}
    </div>
  `;
}

/** @param {HTMLElement} root */
async function loadSyncIssuesSection(root) {
  const el = root.querySelector('#fleetOpsSyncIssues');
  if (!el) return;
  const { data } = await apiGet('/mods/fleet/sync-issues');
  if (!data.ok) {
    el.innerHTML = `<h3>Stuck syncs</h3><p class="panel-hint">${escapeHtml(data.message || 'Unavailable')}</p>`;
    return;
  }
  const issues = data.issues || [];
  if (!issues.length) {
    el.innerHTML = `
      <h3>Stuck syncs</h3>
      <p class="panel-hint">No pending, syncing, or failed inventory rows.</p>
    `;
    return;
  }

  const needsPoll = distNeedsPolling(issues);
  el.innerHTML = `
    <h3>Stuck syncs${needsPoll ? ' · live' : ''}</h3>
    <p class="panel-hint">Cross-mod view of non-ready inventory. Fix agent issues here, then re-sync from Cars / Tracks if needed.</p>
    <table class="mod-dist-table">
      <thead>
        <tr><th>VPS</th><th>Mod</th><th>Kind</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${issues
          .map((row) => {
            const statusRow = {
              status: row.status,
              progress_pct: row.progress_pct,
              phase: row.phase,
              jobState: row.jobState,
              error_message: row.error_message,
              lastSeenAt: row.last_seen_at,
            };
            return `<tr>
              <td>${escapeHtml(row.edge_label || row.edge_id)}</td>
              <td>${escapeHtml(row.display_name)}</td>
              <td>${escapeHtml(row.kind)}</td>
              <td>${renderModSyncStatusCell(statusRow)}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

/** @param {HTMLElement} root */
async function loadGcSection(root) {
  const el = root.querySelector('#fleetOpsGc');
  if (!el) return;
  const { data } = await apiGet('/mods/gc/candidates');
  if (!data.ok) {
    el.innerHTML = `<h3>Disk GC</h3><p class="panel-hint">${escapeHtml(data.message || 'Unavailable')}</p>`;
    return;
  }
  const candidates = data.candidates || [];
  if (!candidates.length) {
    el.innerHTML = `
      <h3>Disk GC</h3>
      <p class="panel-hint">No unused READY mods on edges (ref_count = 0).</p>
    `;
    return;
  }

  /** @type {Map<string, typeof candidates>} */
  const byEdge = new Map();
  for (const c of candidates) {
    const list = byEdge.get(c.edgeId) ?? [];
    list.push(c);
    byEdge.set(c.edgeId, list);
  }

  el.innerHTML = `
    <h3>Disk GC</h3>
    <p class="panel-hint">READY artifacts with no server requirement — safe to remove from the VPS to free disk.</p>
    ${[...byEdge.entries()]
      .map(([edgeId, rows]) => {
        const label = rows[0]?.edgeLabel || edgeId;
        const totalBytes = rows.reduce((sum, r) => sum + (Number(r.bytesOnDisk) || 0), 0);
        return `
      <div class="fleet-gc-edge" data-gc-edge="${escapeAttr(edgeId)}">
        <div class="fleet-gc-edge-head">
          <strong>${escapeHtml(label)}</strong>
          <span class="panel-hint">${rows.length} unused · ${formatBytes(totalBytes)}</span>
          <button type="button" class="btn btn-sm btn-danger" data-gc-run="${escapeAttr(edgeId)}">Purge selected</button>
        </div>
        <table class="mod-dist-table">
          <thead><tr><th></th><th>Mod</th><th>Slug</th><th>On disk</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
              <td><input type="checkbox" class="fleet-gc-check" value="${escapeAttr(r.artifactId)}" checked></td>
              <td>${escapeHtml(r.packageDisplayName)}</td>
              <td><code>${escapeHtml(r.acContentSlug)}</code></td>
              <td>${r.bytesOnDisk != null ? formatBytes(r.bytesOnDisk) : '—'}</td>
            </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
      })
      .join('')}
  `;

  el.querySelectorAll('[data-gc-run]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const edgeId = /** @type {HTMLElement} */ (btn).getAttribute('data-gc-run');
      if (!edgeId) return;
      const block = [...el.querySelectorAll('[data-gc-edge]')].find(
        (node) => node.getAttribute('data-gc-edge') === edgeId,
      );
      const artifactIds = block
        ? [...block.querySelectorAll('.fleet-gc-check:checked')].map(
            (input) => /** @type {HTMLInputElement} */ (input).value,
          )
        : [];
      if (!artifactIds.length) {
        showToast('Select at least one artifact', 'error');
        return;
      }
      const confirmed = await showConfirm(
        'Purge unused mods',
        `Remove ${artifactIds.length} unused mod(s) from ${edgeId}? Server requirements are unchanged.`,
        'Purge',
      );
      if (!confirmed) return;
      const { res, data: runData } = await apiPost('/mods/gc/run', { edgeId, artifactIds });
      if (!res.ok || !runData.ok) {
        showToast(runData.message || 'GC failed', 'error');
        return;
      }
      showToast(`Removed ${runData.removed ?? 0} from ${edgeId}`, 'success');
      await loadGcSection(root);
    });
  });
}

export async function refreshServerModsReadiness(serverName, fleetEdgeId) {
  const { data } = await apiGet(`/servers/${encodeURIComponent(serverName)}/mods/readiness`, fleetEdgeId);
  return data;
}

export async function syncMissingServerMods(serverName, fleetEdgeId) {
  const { data } = await apiPost(
    `/servers/${encodeURIComponent(serverName)}/mods/sync-missing`,
    {},
    fleetEdgeId,
  );
  return data;
}
