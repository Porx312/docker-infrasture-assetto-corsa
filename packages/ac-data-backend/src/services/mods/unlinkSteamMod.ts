import { forceDeleteModPackage } from './orchestrator.js';
import {
  listLivePackageUsage,
  type PackageUsageRow,
  type ServerPresenceLookup,
} from './serverModRequirements.js';
import {
  countPackageSteamLinks,
  deleteModSteamLink,
  hasModSteamLink,
} from './modSteamLinks.js';

export type UnlinkSteamModResult =
  | {
      status: 'unlinked';
      packageId: string;
      remainingLinks: number;
      /** Present when last steam link was removed but S3/package kept (live/unknown usage). */
      purgeSkipped?: 'mod_in_use';
      usage?: PackageUsageRow[];
    }
  | {
      status: 'purged';
      packageId: string;
      displayName: string;
      edgesPurged: string[];
      edgesFailed: Array<{ edgeId: string; message: string }>;
    };

export type UnlinkSteamModOpts = {
  presenceLookup?: ServerPresenceLookup;
};

/**
 * Remove steam↔package link always (user can leave "my cars").
 * Purge S3+VPS+DB when no steam links remain and no requiring server is live
 * (idle/stopped requirements do not block). Convex host-catalog slug is kept.
 */
export async function unlinkSteamMod(
  steamId: string,
  packageId: string,
  opts?: UnlinkSteamModOpts,
): Promise<UnlinkSteamModResult> {
  const linked = await hasModSteamLink(steamId, packageId);
  if (!linked) {
    throw new Error('link_not_found');
  }

  await deleteModSteamLink(steamId, packageId);
  const remainingLinks = await countPackageSteamLinks(packageId);

  if (remainingLinks > 0) {
    return {
      status: 'unlinked',
      packageId,
      remainingLinks,
    };
  }

  const liveUsage = await listLivePackageUsage(packageId, undefined, {
    presenceLookup: opts?.presenceLookup,
  });
  if (liveUsage.length > 0) {
    return {
      status: 'unlinked',
      packageId,
      remainingLinks: 0,
      purgeSkipped: 'mod_in_use',
      usage: liveUsage,
    };
  }

  const purged = await forceDeleteModPackage(packageId, {
    presenceLookup: opts?.presenceLookup,
  });
  return {
    status: 'purged',
    packageId: purged.packageId,
    displayName: purged.displayName,
    edgesPurged: purged.edgesPurged,
    edgesFailed: purged.edgesFailed,
  };
}
