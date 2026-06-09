import fs from 'fs';
import path from 'path';

/** Content Manager discovers the details proxy via this suffix on NAME (see ac-server-wrapper). */
export const CM_SUFFIX_SEP = '\u2139';

/** AC central lobby rejects server names longer than this (see ac-data.log NAME TOO LONG). */
export const LOBBY_NAME_MAX = 128;

export function utf8ByteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

/** Trim base so base + suffix fits lobby char and UTF-8 limits. */
export function trimBaseToFitLobbyName(base: string, suffix: string): string {
    let trimmed = base;
    while (
        trimmed.length + suffix.length > LOBBY_NAME_MAX ||
        utf8ByteLength(trimmed + suffix) > LOBBY_NAME_MAX
    ) {
        if (trimmed.length === 0) {
            break;
        }
        trimmed = trimmed.slice(0, -1).trimEnd();
    }
    return trimmed;
}

export function readCmWrapperPort(serversPath: string, serverName: string): number | null {
    const paramsPath = path.join(serversPath, serverName, 'cfg', 'cm_wrapper_params.json');
    if (!fs.existsSync(paramsPath)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(paramsPath, 'utf-8')) as { port?: number };
        return typeof raw.port === 'number' ? raw.port : null;
    } catch {
        return null;
    }
}

export function stripCmNameSuffix(name: string): string {
    const idx = name.indexOf(CM_SUFFIX_SEP);
    return idx === -1 ? name : name.slice(0, idx).trimEnd();
}

export function applyCmNameSuffix(displayName: string, wrapperPort: number | null): string {
    const base = stripCmNameSuffix(displayName);
    if (wrapperPort == null) {
        return trimBaseToFitLobbyName(base, '');
    }
    const suffix = ` ${CM_SUFFIX_SEP}${wrapperPort}`;
    const trimmed = trimBaseToFitLobbyName(base, suffix);
    return `${trimmed}${suffix}`;
}
