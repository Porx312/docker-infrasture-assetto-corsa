import { apiGet, apiPost } from '../lib/api.js';
import { escapeAttr, escapeHtml } from '../lib/dom.js';
import { distNeedsPolling, renderModSyncStatusCell } from '../lib/modSyncStatus.js';
import { showToast } from '../lib/toast.js';

/** @type {ReturnType<typeof setInterval> | null} */
let fleetDistPollTimer = null;
/** @type {string | null} */
let fleetDistPollArtifactId = null;

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)} MB`;
  return `${num} B`;
}

function stopFleetDistPoll() {
  if (fleetDistPollTimer != null) {
    clearInterval(fleetDistPollTimer);
    fleetDistPollTimer = null;
  }
  fleetDistPollArtifactId = null;
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
async function loadModEdgesHealth(root) {
  const el = root.querySelector('#fleetDeployEdgesHealth');
  if (!el) return;
  const { data } = await apiGet('/mods/edges');
  if (!data.ok) {
    el.innerHTML = `<p class="panel-hint">${data.message || 'Edges unavailable'}</p>`;
    return;
  }
  const edges = data.edges || [];
  if (!edges.length) {
    el.innerHTML =
      '<p class="panel-hint">No fleet edges in DB yet — set FLEET_EDGE_REGISTRY and open this tab (or wait for agent heartbeat).</p>';
    return;
  }
  el.innerHTML = `
    <h3>VPS edges (mod agent)</h3>
    <p class="panel-hint">Deploy catalog mods from Cars/Tracks to these edges. PENDING stuck? Agent offline or wrong EDGE_ID.</p>
    <table class="mod-dist-table">
      <thead><tr><th>EDGE_ID</th><th>Label</th><th>Enabled</th><th>Last seen</th><th>Disk free</th></tr></thead>
      <tbody>
        ${edges
          .map((e) => {
            const stale = edgeHealthClass(e.last_seen_at);
            return `<tr class="${stale}">
              <td><code>${escapeHtml(e.id)}</code></td>
              <td>${escapeHtml(e.label || e.id)}</td>
              <td>${e.enabled === false ? 'no' : 'yes'}</td>
              <td>${formatLastSeen(e.last_seen_at)}</td>
              <td>${e.disk_free_bytes != null ? formatBytes(e.disk_free_bytes) : '—'}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

/** @param {HTMLElement} root */
export function mountModDistributionPanel(root) {
  root.innerHTML = `
    <section class="panel-section">
      <header class="panel-header">
        <div>
          <h2>Fleet deploy</h2>
          <p class="panel-hint">Sync catalog mods to VPS edges. Upload cars/tracks from the Cars and Tracks tabs first.</p>
        </div>
      </header>
      <div id="fleetDeployEdgesHealth" class="mod-dist-edges card"></div>
      <div id="fleetDeployCatalog" class="mod-dist-catalog"></div>
      <div id="fleetDeployDetail" class="mod-dist-detail hidden"></div>
    </section>
  `;
}

/** Alias used by dashboard after rename */
export const mountFleetDeployPanel = mountModDistributionPanel;

/** @param {HTMLElement} root */
export async function loadModDistributionPanel(root) {
  await loadModEdgesHealth(root);
  const catalog = root.querySelector('#fleetDeployCatalog');
  if (!catalog) return;
  const { data } = await apiGet('/mods');
  if (!data.ok) {
    catalog.innerHTML = `<p class="panel-hint">${data.message || 'Mod DB unavailable (set DATABASE_URL on hub)'}</p>`;
    return;
  }
  const packages = data.packages || [];
  if (!packages.length) {
    catalog.innerHTML =
      '<p class="panel-hint">No mods in catalog — upload ZIPs from Cars or Tracks.</p>';
    return;
  }
  catalog.innerHTML = `
    <h3>Catalog packages</h3>
    <div class="mod-dist-catalog-grid">
      ${packages
        .map((pkg) => {
          const art = pkg.latest_artifact;
          const meta = art
            ? `v${escapeHtml(art.version_label)} · ${formatBytes(art.size_bytes)} · ${escapeHtml((art.sha256 || '').slice(0, 12))}…`
            : 'No artifact';
          return `<article class="card mod-dist-card" data-artifact-id="${escapeAttr(art?.id || '')}">
            <h3>${escapeHtml(pkg.display_name)}</h3>
            <p class="panel-hint">${escapeHtml(pkg.kind)} · ${escapeHtml(pkg.ac_content_slug)} · ${meta}</p>
            <button type="button" class="btn btn-sm btn-primary fleet-deploy-view" data-artifact-id="${escapeAttr(art?.id || '')}" ${art?.id ? '' : 'disabled'}>
              Deploy / verify
            </button>
          </article>`;
        })
        .join('')}
    </div>
  `;

  catalog.querySelectorAll('.fleet-deploy-view').forEach((btn) => {
    btn.addEventListener('click', () => openDistributionDetail(root, btn.dataset.artifactId));
  });
}

export const loadFleetDeployPanel = loadModDistributionPanel;

/**
 * @param {HTMLElement} root
 * @param {string | undefined} artifactId
 * @param {{ preserveSelection?: boolean; quiet?: boolean }} [opts]
 */
async function openDistributionDetail(root, artifactId, opts = {}) {
  if (!artifactId) return;
  const detail = root.querySelector('#fleetDeployDetail');
  if (!detail) return;

  /** @type {Set<string> | null} */
  let prevSelected = null;
  if (opts.preserveSelection) {
    prevSelected = new Set(
      [...detail.querySelectorAll('.mod-edge-check:checked')].map(
        (el) => /** @type {HTMLInputElement} */ (el).value,
      ),
    );
  }

  if (!opts.quiet) {
    detail.classList.remove('hidden');
    detail.innerHTML = '<p class="panel-hint">Loading…</p>';
  }

  const { data } = await apiGet(`/mods/artifacts/${artifactId}/distribution`);
  if (!data.ok) {
    stopFleetDistPoll();
    detail.innerHTML = `<p>${data.message || 'Failed'}</p>`;
    return;
  }
  const art = data.artifact;
  const rows = data.distribution || [];
  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="card">
      <header class="panel-header">
        <div>
          <h3>${escapeHtml(art?.package?.display_name || 'Mod')} · v${escapeHtml(art?.version_label || '')}</h3>
          <p class="panel-hint">${formatBytes(art?.size_bytes)} · SHA ${escapeHtml((art?.sha256 || '').slice(0, 16))}…${
            distNeedsPolling(rows) ? ' · Updating live…' : ''
          }</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="modDistClose">Close</button>
      </header>
      <table class="mod-dist-table">
        <thead><tr><th></th><th>VPS</th><th>Status</th></tr></thead>
        <tbody>
          ${rows
            .map((row) => {
              const checked =
                !prevSelected || prevSelected.has(row.edge_id) ? ' checked' : '';
              return `<tr>
              <td><input type="checkbox" class="mod-edge-check" value="${escapeAttr(row.edge_id)}"${checked} /></td>
              <td>${escapeHtml(row.label)}</td>
              <td>${renderModSyncStatusCell(row)}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="modSyncSelected">Sync selected</button>
        <button type="button" class="btn btn-ghost" id="modVerifySelected">Verify</button>
        <button type="button" class="btn btn-danger" id="modRemoveSelected">Remove from selected</button>
      </div>
    </div>
  `;

  const selectedEdges = () =>
    [...detail.querySelectorAll('.mod-edge-check:checked')].map(
      (el) => /** @type {HTMLInputElement} */ (el).value,
    );

  detail.querySelector('#modDistClose')?.addEventListener('click', () => {
    stopFleetDistPoll();
    detail.classList.add('hidden');
    detail.innerHTML = '';
  });

  detail.querySelector('#modSyncSelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/distribute`, { edgeIds });
    showToast(res.ok ? `Enqueued ${res.enqueued} jobs` : res.message, res.ok ? 'success' : 'error');
    await openDistributionDetail(root, artifactId);
  });

  detail.querySelector('#modVerifySelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/verify`, { edgeIds });
    showToast(res.ok ? `Verify enqueued (${res.enqueued})` : res.message, res.ok ? 'success' : 'error');
  });

  detail.querySelector('#modRemoveSelected')?.addEventListener('click', async () => {
    const edgeIds = selectedEdges();
    const { data: res } = await apiPost(`/mods/artifacts/${artifactId}/remove-from-edges`, { edgeIds });
    showToast(res.ok ? 'Remove scheduled' : res.message, res.ok ? 'success' : 'error');
    await openDistributionDetail(root, artifactId);
  });

  if (distNeedsPolling(rows)) {
    if (fleetDistPollArtifactId !== artifactId) {
      stopFleetDistPoll();
      fleetDistPollArtifactId = artifactId;
      fleetDistPollTimer = setInterval(() => {
        void openDistributionDetail(root, artifactId, { preserveSelection: true, quiet: true });
      }, 2000);
    }
  } else {
    stopFleetDistPoll();
  }
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
