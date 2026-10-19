/**
 * CSP minimum-version TRACK encoding for Assetto Corsa servers.
 *
 * Clients see: TRACK=csp/<build>/../<trackSlug>
 * Disk folder remains content/tracks/<trackSlug> (the `../` resolves it).
 *
 * Build IDs (examples): CSP 0.2.1 → 2735, CSP 0.2.11 → 3465.
 * Env: AC_CSP_MIN_BUILD (default 2735; set 0 / off / false to disable wrapping).
 */

const DEFAULT_CSP_MIN_BUILD = 2735;

/** Strip `csp/<build>/../` or `csp/<build>/../<opts>/../` → folder slug. */
export function stripCspTrackPrefix(track: string): string {
  const t = (track || '').trim();
  if (!t) return '';
  // Prefer opts form first so `csp/2735/../D/../akina` does not leave `D/../akina`.
  const withOpts = /^csp\/\d+\/\.\.\/[^/]+\/\.\.\/(.+)$/i.exec(t);
  if (withOpts?.[1]) {
    return withOpts[1].trim();
  }
  const simple = /^csp\/\d+\/\.\.\/(.+)$/i.exec(t);
  if (simple?.[1]) {
    return simple[1].trim();
  }
  return t;
}

/** Build TRACK value with optional CSP min build wrapper. */
export function formatCspMinTrack(slugOrTrack: string, build: number): string {
  const slug = stripCspTrackPrefix(slugOrTrack);
  if (!slug) return '';
  if (!Number.isFinite(build) || build <= 0) {
    return slug;
  }
  return `csp/${Math.trunc(build)}/../${slug}`;
}

/**
 * Resolve fleet CSP min build from env.
 * Unset → 2735 (CSP 0.2.1). `0` / `off` / `false` → disabled.
 */
export function resolveCspMinBuild(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  if (!Object.prototype.hasOwnProperty.call(env, 'AC_CSP_MIN_BUILD')) {
    return DEFAULT_CSP_MIN_BUILD;
  }
  const raw = String(env.AC_CSP_MIN_BUILD ?? '').trim();
  if (!raw || raw === '0' || raw.toLowerCase() === 'off' || raw.toLowerCase() === 'false') {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return n;
}

/** Apply current env CSP min build to a track slug for server_cfg.ini TRACK=. */
export function applyCspMinTrackForIni(slugOrTrack: string): string {
  return formatCspMinTrack(slugOrTrack, resolveCspMinBuild());
}
