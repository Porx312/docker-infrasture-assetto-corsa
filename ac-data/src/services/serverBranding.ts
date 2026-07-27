import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import '../config/loadEnv.js';

const execFileAsync = promisify(execFile);

export interface ServerBranding {
  description: string;
  webLink: string;
  cmDescriptionBody: string;
  loadingImageUrl: string;
  bannerImageUrl: string;
}

export interface ServerBrandingSummary {
  name: string;
  displayName: string | null;
  httpPort: number | null;
  wrapperPort: number | null;
}

const DEFAULT_BRANDING: ServerBranding = {
  description: '',
  webLink: '',
  cmDescriptionBody: '',
  loadingImageUrl: '',
  bannerImageUrl: '',
};

function serversPath(): string {
  const value = process.env.SERVERS_PATH?.trim();
  if (!value) {
    throw new Error('SERVERS_PATH is not configured');
  }
  return value;
}

function brandingFilePath(): string {
  return path.join(serversPath(), 'shared', 'server-branding.json');
}

function repoRoot(): string {
  return path.dirname(serversPath());
}

function wrapperPortOffset(): number {
  const raw = process.env.WRAPPER_PORT_OFFSET?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 10_000;
  return Number.isFinite(parsed) ? parsed : 10_000;
}

export function normalizeBranding(input: Partial<ServerBranding>): ServerBranding {
  return {
    description: String(input.description ?? '').trim(),
    webLink: String(input.webLink ?? '').trim(),
    cmDescriptionBody: String(input.cmDescriptionBody ?? input.description ?? '').trim(),
    loadingImageUrl: String(input.loadingImageUrl ?? '').trim(),
    bannerImageUrl: String(input.bannerImageUrl ?? input.loadingImageUrl ?? '').trim(),
  };
}

export function buildCmDescription(branding: ServerBranding): string {
  const body = branding.cmDescriptionBody || branding.description;
  const banner = branding.bannerImageUrl || branding.loadingImageUrl;
  if (banner) {
    return `[img=${banner}]ProjectD[/img]\n\n${body}`;
  }
  return body;
}

function readIniField(content: string, field: string): string | null {
  const match = new RegExp(`^${field}=(.*)$`, 'm').exec(content);
  return match ? match[1].trim() : null;
}

function patchIniField(content: string, field: string, value: string): string {
  const line = `${field}=${value}`;
  if (new RegExp(`^${field}=`, 'm').test(content)) {
    return content.replace(new RegExp(`^${field}=.*$`, 'm'), line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

export function listServerInstanceNames(): string[] {
  const root = serversPath();
  if (!fs.existsSync(root)) {
    return [];
  }

  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('server'))
    .map((entry) => entry.name);

  const templateCfg = path.join(
    repoRoot(),
    'server-templates',
    'server-template',
    'cfg',
    'server_cfg.ini',
  );
  if (fs.existsSync(templateCfg)) {
    names.push('server-template');
  }

  return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function cfgIniPath(serverName: string): string {
  if (serverName === 'server-template') {
    return path.join(repoRoot(), 'server-templates', 'server-template', 'cfg', 'server_cfg.ini');
  }
  return path.join(serversPath(), serverName, 'cfg', 'server_cfg.ini');
}

function wrapperJsonPath(serverName: string): string {
  if (serverName === 'server-template') {
    return path.join(
      repoRoot(),
      'server-templates',
      'server-template',
      'cfg',
      'cm_wrapper_params.json',
    );
  }
  return path.join(serversPath(), serverName, 'cfg', 'cm_wrapper_params.json');
}

export async function readServerBranding(): Promise<ServerBranding> {
  const filePath = brandingFilePath();
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_BRANDING };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ServerBranding>;
  return normalizeBranding(raw);
}

export async function writeServerBranding(branding: ServerBranding): Promise<void> {
  const filePath = brandingFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(branding, null, 2)}\n`, 'utf-8');
}

export function summarizeServers(): ServerBrandingSummary[] {
  return listServerInstanceNames()
    .filter((name) => name !== 'server-template')
    .map((name) => {
      const cfgPath = cfgIniPath(name);
      if (!fs.existsSync(cfgPath)) {
        return { name, displayName: null, httpPort: null, wrapperPort: null };
      }
      const content = fs.readFileSync(cfgPath, 'utf-8');
      const httpPortRaw = readIniField(content, 'HTTP_PORT');
      const httpPort = httpPortRaw ? Number.parseInt(httpPortRaw, 10) : null;
      const wrapperPort =
        httpPort != null && Number.isFinite(httpPort) ? httpPort + wrapperPortOffset() : null;
      return {
        name,
        displayName: readIniField(content, 'NAME'),
        httpPort: Number.isFinite(httpPort!) ? httpPort : null,
        wrapperPort,
      };
    });
}

export async function applyBrandingToServers(branding: ServerBranding): Promise<{
  updatedIni: number;
  updatedWrapper: number;
}> {
  const cmDescription = buildCmDescription(branding);
  let updatedIni = 0;
  let updatedWrapper = 0;

  for (const serverName of listServerInstanceNames()) {
    const cfgPath = cfgIniPath(serverName);
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf-8');
      let next = patchIniField(content, 'DESCRIPTION', branding.description);
      next = patchIniField(next, 'WEBLINK', branding.webLink);
      fs.writeFileSync(cfgPath, next, 'utf-8');
      updatedIni += 1;

      const httpPortRaw = readIniField(next, 'HTTP_PORT');
      const httpPort = httpPortRaw ? Number.parseInt(httpPortRaw, 10) : NaN;
      if (Number.isFinite(httpPort)) {
        const wrapperPort = httpPort + wrapperPortOffset();
        const wrapperPath = wrapperJsonPath(serverName);
        fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });

        const wrapperData: Record<string, unknown> = {
          description: cmDescription,
          port: wrapperPort,
          verboseLog: false,
          downloadSpeedLimit: 0,
          downloadPasswordOnly: false,
          publishPasswordChecksum: true,
        };
        if (branding.loadingImageUrl) {
          wrapperData.loadingImageUrl = branding.loadingImageUrl;
        }

        fs.writeFileSync(wrapperPath, `${JSON.stringify(wrapperData, null, 2)}\n`, 'utf-8');
        updatedWrapper += 1;
      }
    }
  }

  return { updatedIni, updatedWrapper };
}

export async function restartCmProxies(): Promise<void> {
  const root = repoRoot();
  const stopScript = path.join(root, 'scripts', 'stop-cm-proxies.sh');
  const startScript = path.join(root, 'scripts', 'start-cm-proxies.sh');

  if (fs.existsSync(stopScript)) {
    await execFileAsync('bash', [stopScript], { cwd: root });
  }
  if (fs.existsSync(startScript)) {
    await execFileAsync('bash', [startScript], { cwd: root });
  }
}

export async function saveAndApplyBranding(
  input: Partial<ServerBranding>,
): Promise<{ branding: ServerBranding; updatedIni: number; updatedWrapper: number }> {
  const branding = normalizeBranding(input);
  await writeServerBranding(branding);
  const applied = await applyBrandingToServers(branding);
  await restartCmProxies();
  return { branding, ...applied };
}
