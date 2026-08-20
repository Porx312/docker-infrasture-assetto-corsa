#!/usr/bin/env npx tsx
/** Replay Redis battle_update + battle_finished batch against Convex ingest. */
import { buildIngestEvent } from '../ac-data/src/services/ingestEventBuilder.js';
import { ensureConvexClient } from '../ac-data/src/services/convexClient.js';

const REAL_BATCH = [
  {
    eventId: 'a4daaec6-e8e7-4853-b7d6-008a313f1aef',
    schemaVersion: '1',
    event: 'battle_update',
    serverName: 'Gunsai Testing',
    instanceId: 'vps-eu-2',
    ts: 1787228280938,
    data: {
      battleId: 'battle-242d2a412c08',
      player1SteamId: '76561199230780195',
      player2SteamId: '76561198706313764',
      player1Score: 1,
      player2Score: 0,
      player1Car: 'ks_mazda_rx7_spirit_r',
      player2Car: 'ks_mazda_rx7_spirit_r',
      player1Name: 'PORX',
      player2Name: 'projectd',
      pointsLog: [{ scorer: '76561199230780195', reason: 'overtake', ts: 1787228271536, seq: 1 }],
      status: 'finished',
      serverName: 'Gunsai Testing',
      track: 'pk_akina',
      trackConfig: 'akina_downhill',
      winnerSteamId: '76561199230780195',
    },
  },
  {
    eventId: '11254d43-6e7b-469c-bfcd-300657fe1403',
    schemaVersion: '1',
    event: 'battle_finished',
    serverName: 'Gunsai Testing',
    instanceId: 'vps-eu-2',
    ts: 1787228280939,
    data: {
      battleId: 'battle-242d2a412c08',
      player1SteamId: '76561199230780195',
      player2SteamId: '76561198706313764',
      player1Score: 1,
      player2Score: 0,
      player1Car: 'ks_mazda_rx7_spirit_r',
      player2Car: 'ks_mazda_rx7_spirit_r',
      player1Name: 'PORX',
      player2Name: 'projectd',
      pointsLog: [{ scorer: '76561199230780195', reason: 'overtake', ts: 1787228271536, seq: 1 }],
      status: 'finished',
      serverName: 'Gunsai Testing',
      track: 'pk_akina',
      trackConfig: 'akina_downhill',
      winnerSteamId: '76561199230780195',
    },
  },
];

async function main(): Promise<void> {
  const secret = process.env.CONVEX_INGEST_SECRET?.trim();
  if (!secret) {
    console.error('CONVEX_INGEST_SECRET missing');
    process.exit(1);
  }

  const mutationName =
    process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
  const { mutation } = ensureConvexClient();
  const events = REAL_BATCH.map(buildIngestEvent);
  const result = await mutation(mutationName, { ingestSecret: secret, events });
  console.log(JSON.stringify(result, null, 2));

  const rows = (result as { results?: Array<{ ok?: boolean; error?: string; eventType?: string; index?: number }> })
    ?.results;
  const failed = rows?.filter((r) => r.ok !== true) ?? [];
  if (failed.length > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
