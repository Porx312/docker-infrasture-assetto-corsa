import { forceDeleteModPackage, ModInUseError } from './orchestrator.js';
import { listPackageUsage } from './serverModRequirements.js';
import {
  countPackageSteamLinks,
  deleteModSteamLink,
  hasModSteamLink,
} from './modSteamLinks.js';

export type UnlinkSteamModResult =
  | { status: 'unlinked'; packageId: string; remainingLinks: number }
  | {
      status: 'purged';
      packageId: string;
      displayName: string;
      edgesPurged: string[];
      edgesFailed: Array<{ edgeId: string; message: string }>;
    };

/**
 * Remove steam↔package link. If last link, purge library (S3+VPS+DB) unless in use on servers.
 */
export async function unlinkSteamMod(
  steamId: string,
  packageId: string,
): Promise<UnlinkSteamModResult> {
  const linked = await hasModSteamLink(steamId, packageId);
  if (!linked) {
    throw new Error('link_not_found');
  }

  const count = await countPackageSteamLinks(packageId);
  if (count <= 1) {
    const usage = await listPackageUsage(packageId);
    if (usage.length > 0) {
      throw new ModInUseError(usage);
    }
    // Last link: purge removes package (CASCADE drops remaining link).
    const purged = await forceDeleteModPackage(packageId);
    return {
      status: 'purged',
      packageId: purged.packageId,
      displayName: purged.displayName,
      edgesPurged: purged.edgesPurged,
      edgesFailed: purged.edgesFailed,
    };
  }

  await deleteModSteamLink(steamId, packageId);
  return {
    status: 'unlinked',
    packageId,
    remainingLinks: count - 1,
  };
}
