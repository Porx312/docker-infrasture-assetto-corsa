import type { Request, Response } from 'express';
import {
  isFleetModeEnabled,
  listFleetEdges,
} from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { fetchMergedFleetServers } from '../services/fleet/fleetServersMerge.js';

export async function listFleetEdgesHandler(_req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    fleetMode: isFleetModeEnabled(),
    edges: listFleetEdges().map((edge) => ({
      id: edge.id,
      label: edge.label,
      instanceId: edge.instanceId ?? null,
    })),
  });
}

export async function listMergedFleetServersHandler(_req: Request, res: Response): Promise<void> {
  if (!isFleetModeEnabled()) {
    res.status(400).json({ ok: false, message: 'Fleet mode not configured' });
    return;
  }
  try {
    const payload = await fetchMergedFleetServers();
    res.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message });
  }
}
