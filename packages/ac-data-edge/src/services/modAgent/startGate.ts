import { readServerInstanceConfig } from '../serverInstanceConfig.js';
import { isModAgentEnabled, refreshServerModsOnHub } from './hubModClient.js';

export type ModStartGateResult =
  | { ok: true }
  | { ok: false; code: 'MODS_NOT_READY'; items: Array<{ acContentSlug: string; status: string }> };

export async function assertModsReadyForServerStart(serverName: string): Promise<ModStartGateResult> {
  if (!isModAgentEnabled()) {
    return { ok: true };
  }
  const config = readServerInstanceConfig(serverName);
  const readiness = await refreshServerModsOnHub({
    serverName,
    track: config.track,
    cars: config.cars,
  });
  if (readiness.ready) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'MODS_NOT_READY',
    items: readiness.items.map((item) => ({
      acContentSlug: item.acContentSlug,
      status: item.status,
    })),
  };
}
