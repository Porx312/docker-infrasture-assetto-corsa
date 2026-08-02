import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import '../config/loadEnv.js';

const execFileAsync = promisify(execFile);

export const MAX_LOADING_IMAGE_URLS = 20;

export interface ServerBranding {
  description: string;
  webLink: string;
  cmDescriptionBody: string;
  /** First loading URL; kept for backward compatibility with scripts and per-server overrides. */
  loadingImageUrl: string;
  /** Rotating loading screens; CM proxy picks one at random per join. */
  loadingImageUrls: string[];
  bannerImageUrl: string;
}

export type ServerBrandingInput = Partial<ServerBranding> & {
  loadingImageUrls?: unknown;
};

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
  loadingImageUrls: [],
  bannerImageUrl: '',
};

function normalizeLoadingImageUrls(input: ServerBrandingInput): string[] {
  const candidates: string[] = [];
  if (Array.isArray(input.loadingImageUrls)) {
    for (const url of input.loadingImageUrls) {
      const trimmed = String(url).trim();
      if (trimmed) {
        candidates.push(trimmed);
      }
    }
  }
  const legacy = String(input.loadingImageUrl ?? '').trim();
  if (candidates.length === 0 && legacy) {
    candidates.push(legacy);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const url of candidates) {
    if (!seen.has(url)) {
      seen.add(url);
      deduped.push(url);
    }
  }
  return deduped.slice(0, MAX_LOADING_IMAGE_URLS);
}

/** Pick one loading screen URL (random by default). */
export function pickLoadingImageUrl(
  urls: string[],
  randomFn: () => number = Math.random,
): string {
  if (urls.length === 0) {
    return '';
  }
  const index = Math.min(urls.length - 1, Math.floor(randomFn() * urls.length));
  return urls[index] ?? urls[0] ?? '';
}

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

export function normalizeBranding(input: ServerBrandingInput): ServerBranding {
  const loadingImageUrls = normalizeLoadingImageUrls(input);
  const loadingImageUrl = loadingImageUrls[0] ?? '';
  return {
    description: String(input.description ?? '').trim(),
    webLink: String(input.webLink ?? '').trim(),
    cmDescriptionBody: String(input.cmDescriptionBody ?? input.description ?? '').trim(),
    loadingImageUrl,
    loadingImageUrls,
    bannerImageUrl: String(
      input.bannerImageUrl ?? loadingImageUrl ?? input.loadingImageUrl ?? '',
    ).trim(),
  };
}

export function buildCmDescription(branding: ServerBranding): string {
  const body = branding.cmDescriptionBody || branding.description;
  const banner = branding.bannerImageUrl || branding.loadingImageUrls[0] || branding.loadingImageUrl;
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
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ServerBrandingInput;
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
        if (branding.loadingImageUrls.length > 0) {
          wrapperData.loadingImageUrls = branding.loadingImageUrls;
          wrapperData.loadingImageUrl = branding.loadingImageUrls[0];
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
  input: ServerBrandingInput,
): Promise<{ branding: ServerBranding; updatedIni: number; updatedWrapper: number }> {
  const branding = normalizeBranding(input);
  await writeServerBranding(branding);
  const applied = await applyBrandingToServers(branding);
  await restartCmProxies();
  return { branding, ...applied };
}
