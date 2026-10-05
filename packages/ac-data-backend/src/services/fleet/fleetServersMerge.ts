import { buildAcstuffJoinUrl } from '@projectd/ac-data-shared/services/acstuffJoinUrl.js';
import {
  listFleetEdges,
  resolveFleetJoinIp,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { fetchEdgeJson } from './fleetEdgeAdminFetch.js';

export type FleetServerRow = {
  fleetEdgeId: string;
  fleetLabel: string;
  instanceId: string | null;
  name: string;
  displayName: string | null;
  wrapperPort: number | null;
  httpPort: number | null;
  joinIp: string | null;
  joinUrl: string | null;
};

export type FleetServersResult = {
  ok: true;
  fleetMode: true;
  servers: FleetServerRow[];
  warnings?: string[];
};

export async function fetchMergedFleetServers(): Promise<FleetServersResult> {
  const edges = listFleetEdges();
  const warnings: string[] = [];
  const servers: FleetServerRow[] = [];

  const results = await Promise.all(
    edges.map(async (edge) => {
      const result = await fetchEdgeJson<{
        ok: boolean;
        servers?: Array<{
          name: string;
          displayName?: string | null;
          wrapperPort?: number | null;
          httpPort?: number | null;
        }>;
      }>(edge, '/admin/branding');
      return { edge, result };
    }),
  );

  for (const { edge, result } of results) {
    if (!result.ok || !result.data?.servers) {
      warnings.push(`${edge.label}: ${result.error ?? `HTTP ${result.status}`}`);
      continue;
    }
    const joinIp = resolveFleetJoinIp(edge);
    for (const server of result.data.servers) {
      const httpPort = server.httpPort ?? null;
      servers.push({
        fleetEdgeId: edge.id,
        fleetLabel: edge.label,
        instanceId: edge.instanceId ?? null,
        name: server.name,
        displayName: server.displayName ?? null,
        wrapperPort: server.wrapperPort ?? null,
        httpPort,
        joinIp,
        joinUrl: buildAcstuffJoinUrl(joinIp, httpPort),
      });
    }
  }

  servers.sort((a, b) => {
    const label = a.fleetLabel.localeCompare(b.fleetLabel);
    if (label !== 0) {
      return label;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    fleetMode: true,
    servers,
    warnings: warnings.length ? warnings : undefined,
  };
}
