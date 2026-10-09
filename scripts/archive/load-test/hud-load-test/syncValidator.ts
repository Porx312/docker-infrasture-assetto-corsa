import type { BattlePair } from './battleSimulator.js';
import type { HudSimClient } from './hudClient.js';

export type SyncReport = {
  divergenceRate: number;
  staleRate: number;
  revisionRegressionRate: number;
  stuckClients: number;
  pairChecks: number;
  divergentPairs: number;
};

export function evaluateSync(clients: HudSimClient[], pairs: BattlePair[]): SyncReport {
  let staleCount = 0;
  let revisionRegressions = 0;
  let stuckClients = 0;
  let totalSnapshots = 0;

  for (const client of clients) {
    const m = client.metrics;
    staleCount += m.staleSnapshots;
    revisionRegressions += m.revisionRegressions;
    totalSnapshots += m.successfulSnapshots;
    if (client.isStuck()) {
      stuckClients += 1;
    }
  }

  let pairChecks = 0;
  let divergentPairs = 0;

  for (const pair of pairs) {
    const a = clients.find((c) => c.metrics.steamId === pair.clientA);
    const b = clients.find((c) => c.metrics.steamId === pair.clientB);
    if (!a?.metrics.lastSnapshot || !b?.metrics.lastSnapshot) {
      continue;
    }
    if (pair.clientA === pair.clientB) {
      continue;
    }
    pairChecks += 1;
    const sa = a.metrics.lastSnapshot;
    const sb = b.metrics.lastSnapshot;

    const diverged =
      sa.battleId !== sb.battleId ||
      sa.state !== sb.state ||
      sa.p1Score !== sb.p1Score ||
      sa.p2Score !== sb.p2Score ||
      sa.pointsLogLen !== sb.pointsLogLen;

    if (diverged) {
      divergentPairs += 1;
    }
  }

  const divergenceRate = pairChecks > 0 ? divergentPairs / pairChecks : 0;
  const staleRate = totalSnapshots > 0 ? staleCount / totalSnapshots : 0;
  const revisionRegressionRate =
    totalSnapshots > 0 ? revisionRegressions / totalSnapshots : 0;

  return {
    divergenceRate,
    staleRate,
    revisionRegressionRate,
    stuckClients,
    pairChecks,
    divergentPairs,
  };
}
