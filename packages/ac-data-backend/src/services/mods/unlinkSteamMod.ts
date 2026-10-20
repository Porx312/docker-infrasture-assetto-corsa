import { forceDeleteModPackage } from './orchestrator.js';
import { listPackageUsage, type PackageUsageRow } from './serverModRequirements.js';
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
      /** Present when last steam link was removed but S3/package kept (still on servers). */
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

/**
 * Remove steam↔package link always (user can leave "my cars").
 * Purge S3+VPS+DB only when no steam links remain and the package is not
 * required by any server config.
 */
export async function unlinkSteamMod(
  steamId: string,
  packageId: string,
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

  const usage = await listPackageUsage(packageId);
  if (usage.length > 0) {
    return {
      status: 'unlinked',
      packageId,
      remainingLinks: 0,
      purgeSkipped: 'mod_in_use',
      usage,
    };
  }

  const purged = await forceDeleteModPackage(packageId);
  return {
    status: 'purged',
    packageId: purged.packageId,
    displayName: purged.displayName,
    edgesPurged: purged.edgesPurged,
    edgesFailed: purged.edgesFailed,
  };
}
