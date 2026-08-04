/** @typedef {{ id: string; label: string; hint: string; kind: 'content' | 'servers' | 'activity' | 'hud' | 'launcher' }} TabConfig */

/** @type {TabConfig[]} */
export const TABS = [
  {
    id: 'cars',
    label: 'Cars',
    hint: 'Supported: .kn5, .acd, .ini, .zip, folders',
    kind: 'content',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    hint: 'Supported: .kn5, .acd, .ini, .zip, folders',
    kind: 'content',
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
    hint: 'Overlay ZIP for desktop sync',
    kind: 'hud',
  },
  {
    id: 'projectd-launcher',
    label: 'ProjectD Launcher',
    hint: 'Desktop app ZIP for auto-update',
    kind: 'launcher',
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
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

/** @param {string} type */
export function isCardGridType(type) {
  return type === 'cars' || type === 'tracks';
}
