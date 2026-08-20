#!/usr/bin/env npx tsx
/** One-shot: call ingestWorkerEventsBatch with a battle_finished payload and print Convex error. */
import { buildIngestEvent } from '../ac-data/src/services/ingestEventBuilder.js';
import { ensureConvexClient } from '../ac-data/src/services/convexClient.js';

async function main(): Promise<void> {
  const payload = {
    eventId: 'diag-test-battle',
    schemaVersion: '1',
    event: 'battle_finished',
    serverName: 'Gunsai Testing',
    instanceId: process.env.AC_INSTANCE_ID || 'vps-eu-2',
    ts: Date.now(),
    data: {
      battleId: 'battle-diag-test',
      player1SteamId: '76561199230780195',
      player2SteamId: '76561198706313764',
      player1Score: 1,
      player2Score: 0,
      player1Car: 'ks_mazda_rx7_spirit_r',
      player2Car: 'ks_mazda_rx7_spirit_r',
      player1Name: 'PORX',
      player2Name: 'projectd',
      pointsLog: [{ scorer: '76561199230780195', reason: 'overtake', ts: Date.now(), seq: 1 }],
      status: 'finished',
      serverName: 'Gunsai Testing',
      track: 'pk_akina',
      trackConfig: 'akina_downhill',
      winnerSteamId: '76561199230780195',
    },
  };

  const secret = process.env.CONVEX_INGEST_SECRET?.trim();
  if (!secret) {
    console.error('CONVEX_INGEST_SECRET missing');
    process.exit(1);
  }

  const mutationName =
    process.env.CONVEX_MUTATION_BATCH || 'serverEvents:ingestWorkerEventsBatch';
  const { mutation } = ensureConvexClient();
  const result = await mutation(mutationName, {
    ingestSecret: secret,
    events: [buildIngestEvent(payload)],
  });
  console.log(JSON.stringify(result, null, 2));

  const row = (result as { results?: Array<{ ok?: boolean; error?: string }> })?.results?.[0];
  if (row?.ok === false) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
