export type HudSnapshotSections = 'full' | 'battle' | 'session';

export function parseHudSnapshotSections(value: unknown): HudSnapshotSections {
  if (typeof value !== 'string') {
    return 'full';
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'battle') {
    return 'battle';
  }
  if (trimmed === 'session') {
    return 'session';
  }
  return 'full';
}
