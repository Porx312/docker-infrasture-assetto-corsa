import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import {
  edgeFolderStorageKey,
  isEdgeFolderStorageKey,
  type EdgeFolderKind,
} from '@projectd/ac-data-shared/mods/edgeBlobStorage.js';
import {
  createPackageAndArtifact,
  getPackageById,
  markArtifactReadyOnEdge,
} from './catalogRepo.js';
import { syncFleetEdgesToDb } from './fleetEdgeDb.js';
import { syncHostCatalogUpsert } from '../hostCatalog/index.js';
import { modPreviewPublicUrl } from './modPreviewImages.js';
import { schedulePromoteArtifactToS3 } from './promoteArtifactToS3.js';

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
  /** New writes must be edge_folder (legacy edge blob origin rejected). */
  storageOrigin?: 'edge' | 'edge_folder';
  manifest: ModManifest;
};

function folderKindFromMod(kind: ModKind): EdgeFolderKind | null {
  if (kind === 'car' || kind === 'track' || kind === 'weather') return kind;
  return null;
}

export type RegisterEdgeLocalArtifactResult = {
  packageId: string;
  artifactId: string;
  hostCatalogSynced: boolean;
  hostCatalogSyncError?: string;
};

/** Catalog row only — content already lives on the reporting edge as edge_folder. */
export async function registerEdgeLocalArtifact(
  input: RegisterEdgeLocalArtifactInput,
): Promise<RegisterEdgeLocalArtifactResult> {
  const edgeId = input.edgeId.trim().toLowerCase();
  if (!edgeId) {
    throw new Error('edgeId required');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
    throw new Error('invalid sha256 (contentHash)');
  }

  if (input.storageOrigin === 'edge') {
    throw new Error(
      'storageOrigin=edge is disabled; use edge_folder (slim upload / adopt) or S3 library upload',
    );
  }

  if (input.storageKey?.trim() && !isEdgeFolderStorageKey(input.storageKey.trim())) {
    throw new Error('storageKey must be edge-folder:…');
  }

  let storageKey = input.storageKey?.trim() || '';
  if (!storageKey) {
    const fk = folderKindFromMod(input.kind);
    if (!fk) throw new Error('edge_folder requires kind car|track|weather');
    storageKey = edgeFolderStorageKey(edgeId, fk, input.acContentSlug, input.sha256);
  }
  if (!isEdgeFolderStorageKey(storageKey)) {
    throw new Error('storageOrigin edge_folder requires edge-folder storageKey');
  }
  const origin = 'edge_folder' as const;

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
    storageOrigin: origin,
    sourceEdgeId: edgeId,
  });
  await markArtifactReadyOnEdge({
    edgeId,
    artifactId,
    packageId,
    sha256: input.sha256.toLowerCase(),
    bytesOnDisk: input.sizeBytes,
  });
  let hostCatalogSynced = false;
  let hostCatalogSyncError: string | undefined;
  try {
    const pkg = await getPackageById(packageId);
    const coverImageFilename = pkg?.preview_image_filename ?? null;
    const sync = await syncHostCatalogUpsert({
      kind: input.kind,
      displayName: input.displayName.trim(),
      acContentSlug: input.acContentSlug.trim(),
      manifest: input.manifest,
      zipPaths: input.manifest.entryPaths,
      coverImageFilename,
      coverImageUrl: coverImageFilename ? modPreviewPublicUrl(coverImageFilename) : null,
    });
    hostCatalogSynced = sync.synced;
    if (!sync.synced) {
      hostCatalogSyncError = sync.error;
      console.warn(
        `[edge-register] host catalog sync skipped: ${sync.error || 'unknown'}`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    hostCatalogSyncError = message;
    console.warn(`[edge-register] host catalog sync skipped: ${message}`);
  }
  // Best-effort Contabo promote (flagged). Failure must not break register / edge_folder.
  schedulePromoteArtifactToS3(artifactId);

  return {
    packageId,
    artifactId,
    hostCatalogSynced,
    ...(hostCatalogSyncError ? { hostCatalogSyncError } : {}),
  };
}
