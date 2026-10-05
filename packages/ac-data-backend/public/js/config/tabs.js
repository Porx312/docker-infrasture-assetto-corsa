/** @typedef {{ id: string; label: string; hint: string; kind: 'content' | 'mod-catalog' | 'servers' | 'activity' | 'hud' | 'mods' }} TabConfig */

/** @type {TabConfig[]} */
export const TABS = [
  {
    id: 'cars',
    label: 'Cars',
    hint: 'Catalog metadata + VPS sync. Upload ZIPs in Fleet → Upload to VPS.',
    kind: 'mod-catalog',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    hint: 'Catalog metadata + VPS sync. Upload ZIPs in Fleet → Upload to VPS.',
    kind: 'mod-catalog',
  },
  {
    id: 'weather',
    label: 'Weather',
    hint: 'Supported: .ini, .zip, folders',
    kind: 'content',
  },
  {
    id: 'projectd-hud',
    label: 'ProjectD HUD',
    hint: 'HUD overlay ZIP for players',
    kind: 'hud',
  },
  {
    id: 'fleet-deploy',
    label: 'Fleet',
    hint: 'Upload mods to VPS, inventory, agent health, capacity, GC',
    kind: 'mods',
  },
  {
    id: 'servers',
    label: 'Servers',
    hint: '',
    kind: 'servers',
  },
  {
    id: 'activity',
    label: 'Activity',
    hint: '',
    kind: 'activity',
  },
];

/** @param {string} id */
export function getTab(id) {
  if (id === 'mod-distribution') {
    return TABS.find((tab) => tab.id === 'fleet-deploy') ?? TABS[0];
  }
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

/** @param {string} type */
export function isCardGridType(type) {
  return type === 'cars' || type === 'tracks';
}
