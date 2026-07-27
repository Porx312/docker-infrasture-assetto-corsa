/** @typedef {{ id: string; label: string; hint: string; kind: 'content' | 'servers' }} TabConfig */

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
    id: 'servers',
    label: 'Servers',
    hint: '',
    kind: 'servers',
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
