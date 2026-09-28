/**
 * Human-readable sync status + progress bar for mod distribution UI.
 * @param {object} row
 * @returns {string} HTML
 */
export function renderModSyncStatusCell(row) {
  const status = String(row.status || 'UNKNOWN');
  const pct = Math.max(0, Math.min(100, Math.round(Number(row.progress_pct) || 0)));
  const phase = String(row.phase || '').toLowerCase();
  const jobState = String(row.jobState || '').toLowerCase();
  const err = typeof row.error_message === 'string' ? row.error_message.trim() : '';
  const lastSeenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : NaN;
  const agentStale =
    !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > 90_000;

  /** @type {string} */
  let label = status;
  /** @type {string} */
  let hint = '';
  let showBar = false;
  let barPct = pct;

  if (status === 'READY') {
    label = 'Ready';
  } else if (status === 'ERROR' || jobState === 'failed') {
    label = 'Error';
    hint = err || 'Sync failed';
  } else if (status === 'OUTDATED') {
    label = 'Outdated';
    hint = 'Different version on VPS — sync again';
  } else if (status === 'NOT_INSTALLED') {
    label = 'Not installed';
  } else if (status === 'SYNCING' || jobState === 'running') {
    showBar = true;
    if (phase.includes('extract') || phase.includes('install') || phase.includes('material')) {
      label = 'Installing…';
      barPct = Math.max(pct, 90);
    } else if (phase.includes('cache')) {
      label = 'Cache hit…';
      barPct = Math.max(pct, 85);
    } else if (phase.includes('download') || pct > 0) {
      label = `Downloading… ${pct}%`;
      barPct = Math.max(pct, 5);
    } else {
      label = 'Starting…';
      barPct = Math.max(pct, 3);
    }
  } else if (status === 'PENDING' || jobState === 'queued') {
    showBar = true;
    barPct = Math.max(pct, 2);
    if (agentStale) {
      label = 'Waiting for agent…';
      hint = 'Edge offline or wrong EDGE_ID / BACKEND_WORKER_URL';
    } else {
      label = 'Queued…';
      hint = 'Waiting for VPS mod-agent to pick up the job';
    }
  }

  const badgeClass =
    status === 'READY'
      ? 'badge-ok'
      : status === 'ERROR' || jobState === 'failed'
        ? 'badge-danger'
        : status === 'SYNCING' || status === 'PENDING' || jobState === 'running' || jobState === 'queued'
          ? 'badge-warn'
          : 'badge-muted';

  const indeterminate =
    showBar &&
    (status === 'PENDING' || jobState === 'queued') &&
    pct < 5;
  const barHtml = showBar
    ? `<div class="mod-sync-progress${indeterminate ? ' is-indeterminate' : ''}" role="progressbar" aria-valuenow="${barPct}" aria-valuemin="0" aria-valuemax="100">
         <div class="mod-sync-progress-fill" style="width:${barPct}%"></div>
       </div>`
    : '';

  const hintHtml = hint
    ? `<div class="mod-sync-hint">${escapeHtmlLocal(hint)}</div>`
    : '';

  return `<div class="mod-sync-cell">
    <span class="badge ${badgeClass}">${escapeHtmlLocal(label)}</span>
    ${barHtml}
    ${hintHtml}
  </div>`;
}

/** @param {string} s */
function escapeHtmlLocal(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * True if distribution UI should keep polling.
 * @param {Array<{ status?: string; jobState?: string }>} rows
 */
export function distNeedsPolling(rows) {
  return (rows || []).some((row) => {
    const s = String(row.status || '');
    const j = String(row.jobState || '');
    return s === 'PENDING' || s === 'SYNCING' || j === 'queued' || j === 'running';
  });
}
