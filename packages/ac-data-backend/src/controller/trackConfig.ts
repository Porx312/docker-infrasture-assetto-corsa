/** AC: empty CONFIG_TRACK = track's built-in default layout. Never write literal "default". */
export function normalizeTrackConfigForIni(value?: string | null): string | undefined {
    if (value === undefined) return undefined;
    const t = String(value).trim();
    if (t === '' || t.toLowerCase() === 'default') return '';
    return t;
}
