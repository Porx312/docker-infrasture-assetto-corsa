/** Redis keys for Control API mods inventory (hub). */

export function instanceModsCarsKey(instanceId: string): string {
  return `instance:${instanceId}:mods:cars`;
}

export function instanceModsTracksKey(instanceId: string): string {
  return `instance:${instanceId}:mods:tracks`;
}

export function instanceModsMetaKey(instanceId: string): string {
  return `instance:${instanceId}:mods:meta`;
}

export const MODS_INVENTORY_TTL_SEC = Number(process.env.MODS_INVENTORY_TTL_SEC || 86_400);

/** Control-plane agent presence (register / heartbeat). */
export function instanceAgentKey(instanceId: string): string {
  return `instance:${instanceId}:agent`;
}

export const AGENT_PRESENCE_TTL_SEC = Number(process.env.AGENT_PRESENCE_TTL_SEC || 90);
