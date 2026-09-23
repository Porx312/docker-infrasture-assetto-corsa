export type HudRegistryServerRow = {
  serverName?: string;
  displayName?: string;
  type?: string;
};

export type HudRegistrySyncPayload = {
  instanceId: string;
  /** Private/admin base URL (fleet); used for hub→edge HTTP proxy. */
  baseUrl: string;
  /** Player-reachable HTTPS base for direct WSS (bootstrap ws.primary). */
  publicBaseUrl?: string;
  servers: HudRegistryServerRow[];
};

export type HudDynamicRegistryEntry = {
  baseUrl: string;
  publicBaseUrl: string;
  instanceId: string;
  updatedAt: number;
};
