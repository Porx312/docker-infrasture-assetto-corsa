/** @typedef {{ id: string; label: string; hint: string; kind: 'mod-catalog' | 'servers' | 'activity' | 'hud' | 'mods' }} TabConfig */

/** @type {TabConfig[]} */
export const TABS = [
  {
    id: 'cars',
    label: 'Cars',
    hint: 'Mods on the selected VPS. Upload ZIP here; open a card to sync to other VPS.',
    kind: 'mod-catalog',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    hint: 'Tracks on the selected VPS. Upload ZIP here; open a card to sync to other VPS.',
    kind: 'mod-catalog',
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
    hint: 'Agent health, capacity, stuck syncs, disk GC',
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
