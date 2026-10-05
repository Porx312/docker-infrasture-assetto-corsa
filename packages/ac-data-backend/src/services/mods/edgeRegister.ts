import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import { edgeBlobStorageKey, isEdgeBlobStorageKey } from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  createPackageAndArtifact,
  markArtifactReadyOnEdge,
} from './catalogRepo.js';
import { syncFleetEdgesToDb } from './fleetEdgeDb.js';
import { syncHostCatalogUpsert } from '../hostCatalog/index.js';

export type RegisterEdgeLocalArtifactInput = {
  edgeId: string;
  slug: string;
  displayName: string;
  kind: ModKind;
  acContentSlug: string;
  versionLabel: string;
  sizeBytes: number;
  sha256: string;
  storageKey?: string;
  manifest: ModManifest;
};

/** Catalog row only — ZIP already lives on the reporting edge. */
export async function registerEdgeLocalArtifact(
  input: RegisterEdgeLocalArtifactInput,
): Promise<{ packageId: string; artifactId: string }> {
  const edgeId = input.edgeId.trim().toLowerCase();
  if (!edgeId) {
    throw new Error('edgeId required');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
    throw new Error('invalid sha256');
  }
  const storageKey = input.storageKey?.trim() || edgeBlobStorageKey(edgeId, input.sha256);
  if (!isEdgeBlobStorageKey(storageKey)) {
    throw new Error('storageKey must be edge:{edgeId}:{sha256}');
  }

  await syncFleetEdgesToDb();
  const { packageId, artifactId } = await createPackageAndArtifact({
    slug: input.slug.trim(),
    displayName: input.displayName.trim(),
    kind: input.kind,
    acContentSlug: input.acContentSlug.trim(),
    versionLabel: input.versionLabel.trim() || 'edge',
    sizeBytes: input.sizeBytes,
    sha256: input.sha256.toLowerCase(),
    storageKey,
    manifest: input.manifest,
    storageOrigin: 'edge',
    sourceEdgeId: edgeId,
  });
  await markArtifactReadyOnEdge({
    edgeId,
    artifactId,
    packageId,
    sha256: input.sha256.toLowerCase(),
    bytesOnDisk: input.sizeBytes,
  });
  await syncHostCatalogUpsert({
    kind: input.kind,
    displayName: input.displayName.trim(),
    acContentSlug: input.acContentSlug.trim(),
    manifest: input.manifest,
    zipPaths: input.manifest.entryPaths,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[edge-register] host catalog sync skipped: ${message}`);
  });
  return { packageId, artifactId };
}
