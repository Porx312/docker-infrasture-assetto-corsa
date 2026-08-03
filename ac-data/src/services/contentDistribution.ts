import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type SyncContentType = 'cars' | 'tracks';

export type ContentDistribution = 'launcher' | 'steam_dlc';

export interface DistributionInfo {
  distribution: ContentDistribution;
  downloadable: boolean;
  steamStoreUrl: string | null;
  displayName: string | null;
}

interface CatalogDlcEntry {
  displayName?: string;
  steamStoreUrl?: string;
}

interface LauncherContentCatalog {
  assettoCorsaSteamAppId?: string;
  defaultSteamStoreUrl?: string;
  launcherDownloadable?: string[];
  steamDlc?: Record<string, CatalogDlcEntry>;
}

const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = path.join(acDataRoot, '..', '..', 'config', 'launcher-content-catalog.json');

let cachedCatalog: LauncherContentCatalog | null = null;

function catalogPath(): string {
  return process.env.LAUNCHER_CONTENT_CATALOG_PATH || DEFAULT_CATALOG_PATH;
}

function loadCatalog(): LauncherContentCatalog {
  if (cachedCatalog) return cachedCatalog;

  const filePath = catalogPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    cachedCatalog = JSON.parse(raw) as LauncherContentCatalog;
  } catch {
    cachedCatalog = {
      defaultSteamStoreUrl: 'https://store.steampowered.com/app/244210/',
      launcherDownloadable: [],
      steamDlc: {},
    };
  }

  return cachedCatalog;
}

/** Test helper — reset cached catalog between tests. */
export function resetContentDistributionCatalogForTests(): void {
  cachedCatalog = null;
}

export function resolveContentDistribution(type: SyncContentType, name: string): DistributionInfo {
  const catalog = loadCatalog();
  const launcherAllow = new Set(catalog.launcherDownloadable ?? []);
  const dlcEntry = catalog.steamDlc?.[name];
  const defaultSteamUrl = catalog.defaultSteamStoreUrl ?? 'https://store.steampowered.com/app/244210/';

  if (launcherAllow.has(name)) {
    return {
      distribution: 'launcher',
      downloadable: true,
      steamStoreUrl: null,
      displayName: null,
    };
  }

  if (dlcEntry) {
    return {
      distribution: 'steam_dlc',
      downloadable: false,
      steamStoreUrl: dlcEntry.steamStoreUrl ?? defaultSteamUrl,
      displayName: dlcEntry.displayName ?? name,
    };
  }

  if (type === 'cars' && name.startsWith('ks_')) {
    return {
      distribution: 'steam_dlc',
      downloadable: false,
      steamStoreUrl: defaultSteamUrl,
      displayName: name,
    };
  }

  return {
    distribution: 'launcher',
    downloadable: true,
    steamStoreUrl: null,
    displayName: null,
  };
}

export function getDownloadBlockedResponse(
  type: SyncContentType,
  name: string,
): { ok: false; message: string; distribution: 'steam_dlc'; steamStoreUrl: string; displayName: string } {
  const info = resolveContentDistribution(type, name);
  const label = info.displayName ?? name;
  return {
    ok: false,
    message: `"${label}" is official Kunos DLC — purchase on Steam and install via Steam, do not download from launcher`,
    distribution: 'steam_dlc',
    steamStoreUrl: info.steamStoreUrl ?? 'https://store.steampowered.com/app/244210/',
    displayName: label,
  };
}
