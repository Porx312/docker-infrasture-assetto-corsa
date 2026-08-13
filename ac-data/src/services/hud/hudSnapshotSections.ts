export type HudSnapshotSections = 'full' | 'battle';

export function parseHudSnapshotSections(value: unknown): HudSnapshotSections {
  if (typeof value !== 'string') {
    return 'full';
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === 'battle' ? 'battle' : 'full';
}
