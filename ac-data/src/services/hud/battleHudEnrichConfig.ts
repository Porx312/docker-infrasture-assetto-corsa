/** Battle profile enrich from Convex during live pushes (default true). */
export function battleLiveEnrichEnabled(): boolean {
  return (process.env.HUD_BATTLE_ENRICH_LIVE ?? 'true').trim().toLowerCase() !== 'false';
}
