/** Format lap time ms as M:SS.mmm (e.g. 3:27.443). */
export function formatLapMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  const totalSec = ms / 1000;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec - minutes * 60;
  const secStr =
    minutes > 0
      ? seconds.toFixed(3).padStart(6, '0')
      : seconds.toFixed(3);
  return minutes > 0 ? `${minutes}:${secStr}` : secStr;
}

export function formatTrackLabel(trackName: unknown, trackConfig: unknown): string {
  const track = typeof trackName === 'string' ? trackName.trim() : '';
  const layout = typeof trackConfig === 'string' ? trackConfig.trim() : '';
  if (track && layout) {
    return `${track} (${layout})`;
  }
  return track || layout || '';
}
