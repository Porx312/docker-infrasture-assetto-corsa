import { spawn, exec, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { resolveEnvFilePath } from '../config/loadEnv.js';
import { getServerPorts } from './serverPorts.js';

const _serversPath = process.env.SERVERS_PATH;
if (!_serversPath) throw new Error(`SERVERS_PATH no definido en ${resolveEnvFilePath()}`);
const SERVERS_PATH: string = _serversPath;

const PIDS_FILE = path.join(process.cwd(), 'server_pids.json');

const loadPids = (): Record<string, { pid: number }> => {
    try {
        if (fs.existsSync(PIDS_FILE)) {
            return JSON.parse(fs.readFileSync(PIDS_FILE, 'utf-8'));
        }
    } catch (err) {
        console.error('Error cargando PIDs:', err);
    }
    return {};
};

const savePids = () => {
    try {
        const pidsOnly = Object.fromEntries(
            Object.entries(activeServers).map(([k, v]) => [k, v ? { pid: v.pid } : undefined])
        );
        fs.writeFileSync(PIDS_FILE, JSON.stringify(pidsOnly, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error guardando PIDs:', err);
    }
};

export const activeServers: Record<string, { pid: number; process: ChildProcess } | undefined> = {};

function isPortInUse(port: number, type: 'tcp' | 'udp'): boolean {
    try {
        const result = execSync(`ss -${type[0]}lnp 2>/dev/null | grep ':${port}'`, { encoding: 'utf-8' });
        return result.includes(`:${port}`);
    } catch {
        return false;
    }
}

export async function cleanupOrphanProcesses(): Promise<void> {
    console.log('[cleanup] Scanning for orphan AC server processes...');
    const serversPath = SERVERS_PATH;
    if (!fs.existsSync(serversPath)) return;

    const entries = fs.readdirSync(serversPath, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('server')) continue;

        const ports = getServerPorts(SERVERS_PATH, entry.name);
        if (!ports) continue;

        const isUdpInUse = isPortInUse(ports.udp, 'udp');
        const isTcpInUse = isPortInUse(ports.tcp, 'tcp');

        if (isUdpInUse || isTcpInUse) {
            console.log(`[cleanup] ${entry.name} has orphan process on UDP:${ports.udp} TCP:${ports.tcp}`);

            try {
                execSync(`pkill -f "acServer.*${entry.name}" 2>/dev/null`, { encoding: 'utf-8' });
                await new Promise(r => setTimeout(r, 2000));
                console.log(`[cleanup] Killed orphan process for ${entry.name}`);
            } catch {
                console.log(`[cleanup] No process found or already dead for ${entry.name}`);
            }
        }
    }
}

export type ServerConfigPayload = {
    displayName?: string;
    password?: string;
    track?: string;
    configTrack?: string | null;
    maxClients?: number;
    entries?: Array<{ model: string; skin?: string; count?: number }>;
};

/** Escribe server_cfg.ini / entry_list.ini según payload (misma lógica que la antigua API). */
export function applyServerConfiguration(
    serverName: string,
    payload: ServerConfigPayload,
): { ok: true; modifications: string[] } | { ok: false; reason: string } {
    const {
        displayName,
        password,
        track,
        configTrack,
        maxClients,
        entries,
    } = payload;

    const cfgPath = path.join(SERVERS_PATH, serverName, 'cfg', 'server_cfg.ini');
    const entryListPath = path.join(SERVERS_PATH, serverName, 'cfg', 'entry_list.ini');

    if (!fs.existsSync(cfgPath)) {
        return { ok: false, reason: `server_cfg.ini no existe para ${serverName}` };
    }

    const modifications: string[] = [];

    try {
        let content = fs.readFileSync(cfgPath, 'utf-8');

        if (displayName !== undefined) {
            if (/^NAME=.*/m.test(content)) {
                content = content.replace(/^NAME=.*/m, `NAME=${displayName}`);
            } else {
                content += `\nNAME=${displayName}`;
            }
            modifications.push('displayName (NAME)');
        }

        if (password !== undefined) {
            if (/^PASSWORD=.*/m.test(content)) {
                content = content.replace(/^PASSWORD=.*/m, `PASSWORD=${password}`);
            } else {
                content += `\nPASSWORD=${password}`;
            }
            modifications.push('password');
        }

        if (track !== undefined) {
            if (/^TRACK=.*/m.test(content)) {
                content = content.replace(/^TRACK=.*/m, `TRACK=${track}`);
            } else {
                content += `\nTRACK=${track}`;
            }
            modifications.push('track');
        }

        if (configTrack !== undefined) {
            const value = configTrack ?? '';
            if (/^CONFIG_TRACK=.*/m.test(content)) {
                content = content.replace(/^CONFIG_TRACK=.*/m, `CONFIG_TRACK=${value}`);
            } else {
                content += `\nCONFIG_TRACK=${value}`;
            }
            modifications.push('configTrack');
        }

        if (maxClients !== undefined) {
            if (/^MAX_CLIENTS=.*/m.test(content)) {
                content = content.replace(/^MAX_CLIENTS=.*/m, `MAX_CLIENTS=${maxClients}`);
            } else {
                content += `\nMAX_CLIENTS=${maxClients}`;
            }
            modifications.push('maxClients');
        }

        if (entries && Array.isArray(entries)) {
            const models = entries.map((e: { model: string }) => e.model);
            const uniqueModels = [...new Set(models)].join(';');

            if (/^CARS=.*/m.test(content)) {
                content = content.replace(/^CARS=.*/m, `CARS=${uniqueModels}`);
            } else {
                content += `\nCARS=${uniqueModels}`;
            }
            modifications.push('cars (server_cfg.ini)');

            let entryListContent = '';
            let carIndex = 0;
            for (const entry of entries) {
                const count = entry.count || 1;
                for (let i = 0; i < count; i++) {
                    entryListContent += `[CAR_${carIndex}]\n`;
                    entryListContent += `MODEL=${entry.model}\n`;
                    entryListContent += `SKIN=${entry.skin || '0_default'}\n`;
                    entryListContent += `SPECTATOR_MODE=0\n`;
                    entryListContent += `DRIVERNAME=\n`;
                    entryListContent += `TEAM=\n`;
                    entryListContent += `GUID=\n`;
                    entryListContent += `BALLAST=0\n`;
                    entryListContent += `RESTRICTOR=0\n\n`;
                    carIndex++;
                }
            }
            try {
                const entryListStats = fs.lstatSync(entryListPath);
                if (entryListStats.isSymbolicLink()) {
                    fs.unlinkSync(entryListPath);
                }
            } catch {
            }
            fs.writeFileSync(entryListPath, entryListContent, 'utf-8');
            modifications.push('entry_list.ini (regenerated)');
        }

        if (modifications.length === 0) {
            return { ok: true, modifications: [] };
        }

        fs.writeFileSync(cfgPath, content, 'utf-8');
        return { ok: true, modifications };
    } catch (err) {
        console.error(err);
        return { ok: false, reason: String(err) };
    }
}

export function startServerCore(serverName: string): { ok: boolean; message: string } {
    const serverPath = path.join(SERVERS_PATH, serverName, 'acServer');
    if (!fs.existsSync(serverPath)) {
        return { ok: false, message: `El servidor no existe: ${serverName}` };
    }

    if (activeServers[serverName]) {
        return { ok: false, message: `Servidor ${serverName} ya está activo` };
    }

    try {
        const acDir = path.dirname(serverPath);
        const server = spawn(serverPath, ['-c', 'cfg/server_cfg.ini'], {
            cwd: acDir,
            detached: true,
            stdio: 'inherit',
        });

        server.on('error', (err) => {
            console.error(`Error starting server ${serverName}:`, err);
        });

        server.on('exit', (code, signal) => {
            console.log(`Server ${serverName} exited with code ${code}, signal ${signal}`);
            delete activeServers[serverName];
            savePids();
        });

        if (server.pid) {
            server.unref();
            activeServers[serverName] = { pid: server.pid, process: server };
            savePids();
            return { ok: true, message: `Servidor ${serverName} iniciado (PID: ${server.pid})` };
        }
        return { ok: false, message: 'Error al obtener PID del proceso' };
    } catch (err) {
        console.error(err);
        return { ok: false, message: 'Error al iniciar AC Server' };
    }
}

export async function stopServerCore(serverName: string): Promise< { ok: boolean; message: string }> {
    const serverInfo = activeServers[serverName];

    if (!serverInfo?.pid) {
        delete activeServers[serverName];
        savePids();
        return { ok: false, message: `Servidor ${serverName} no estaba activo` };
    }

    const pid = serverInfo.pid;
    const process = serverInfo.process;

    return new Promise((resolve) => {
        try {
            process.kill('SIGKILL');
            delete activeServers[serverName];
            savePids();
            resolve({ ok: true, message: `Servidor ${serverName} detenido (PID ${pid})` });
        } catch (err: any) {
            if (err.message.includes(' ESRCH')) {
                delete activeServers[serverName];
                savePids();
                resolve({ ok: true, message: `Proceso ya no existía; ${serverName} desmarcado.` });
            } else {
                resolve({ ok: false, message: err.message });
            }
        }
    });
}

export async function restartServerCore(serverName: string): Promise<{ ok: boolean; message: string }> {
    const serverPath = path.join(SERVERS_PATH, serverName, 'acServer');
    if (!fs.existsSync(serverPath)) {
        return { ok: false, message: 'Servidor no existe' };
    }

    const serverInfo = activeServers[serverName];
    if (serverInfo?.pid) {
        try {
            serverInfo.process.kill('SIGKILL');
        } catch (err) {
            console.log('Process may already be dead:', err);
        }
        delete activeServers[serverName];
        savePids();
    }

    await new Promise((r) => setTimeout(r, 1000));

    const start = startServerCore(serverName);
    return { ok: start.ok, message: start.message };
}