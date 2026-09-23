import fs from 'fs';
import path from 'path';

/** Parse UDP/TCP game ports from server_cfg.ini (source of truth). */
export function readPortsFromIni(cfgPath: string): { udp: number; tcp: number } | null {
    if (!fs.existsSync(cfgPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(cfgPath, 'utf-8');
        const udpM = /^UDP_PORT=(\d+)/m.exec(content);
        const tcpM = /^TCP_PORT=(\d+)/m.exec(content);
        if (!udpM) {
            return null;
        }
        const udp = parseInt(udpM[1], 10);
        const tcp = tcpM ? parseInt(tcpM[1], 10) : udp;
        if (Number.isNaN(udp) || Number.isNaN(tcp)) {
            return null;
        }
        return { udp, tcp };
    } catch {
        return null;
    }
}

/**
 * Fallback when cfg is missing: server -> 9600, server-N -> 9600 + N*10 (matches CloneServer.sh).
 */
export function derivePortsFromFolderName(serverName: string): { udp: number; tcp: number } | null {
    if (serverName === 'server') {
        return { udp: 9600, tcp: 9600 };
    }
    const m = /^server-(\d+)$/i.exec(serverName);
    if (!m) {
        return null;
    }
    const n = parseInt(m[1], 10);
    const udp = 9600 + n * 10;
    return { udp, tcp: udp };
}

export function getServerPorts(
    serversPath: string,
    serverName: string,
): { udp: number; tcp: number } | null {
    const cfgPath = path.join(serversPath, serverName, 'cfg', 'server_cfg.ini');
    return readPortsFromIni(cfgPath) ?? derivePortsFromFolderName(serverName);
}
