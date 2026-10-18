/**
 * Register a mod that already lives in Contabo S3 — no VPS CONTENT_PATH / inventory READY.
 */
import type { ModKind, ModManifest } from '@projectd/ac-data-shared/mods/types.js';
import {
  isS3CanonicalStorageKey,
  mergeModS3FieldsIntoManifest,
  MOD_S3_FORMAT_TAR_GZ,
  readModS3Fields,
  s3CanonicalStorageKey,
  type ModS3ManifestFields,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';
import { createPackageAndArtifact } from './catalogRepo.js';
import { syncHostCatalogUpsert } from '../hostCatalog/index.js';

export type RegisterS3LibraryArtifactInput = {
  slug: string;
  displayName: string;
  kind: ModKind;
  acContentSlug: string;
  versionLabel: string;
  /** Tree contentHash (sha256 of slim file set). */
  contentHash: string;
  /** Uncompressed slim tree size (catalog size_bytes). */
  sizeBytes: number;
  manifest: ModManifest;
  s3: ModS3ManifestFields;
};

export type RegisterS3LibraryArtifactResult = {
  packageId: string;
  artifactId: string;
  hostCatalogSynced: boolean;
  hostCatalogSyncError?: string;
};

export async function registerS3LibraryArtifact(
  input: RegisterS3LibraryArtifactInput,
): Promise<RegisterS3LibraryArtifactResult> {
  if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) {
    throw new Error('invalid contentHash');
  }
  const s3 = readModS3Fields(input.s3);
  if (!s3) {
    throw new Error('invalid_s3_manifest_fields');
  }
  const storageKey = s3CanonicalStorageKey(input.contentHash);
  if (!isS3CanonicalStorageKey(storageKey)) {
    throw new Error('invalid s3 canonical storage key');
  }

  const baseManifest =
    input.manifest && typeof input.manifest === 'object'
      ? { ...input.manifest }
      : ({
          kind: input.kind,
          acContentSlugs: [input.acContentSlug],
          rootPaths: [],
        } as ModManifest);

  const manifest = mergeModS3FieldsIntoManifest(baseManifest, s3) as ModManifest;

  const { packageId, artifactId } = await createPackageAndArtifact({
    slug: input.slug.trim(),
    displayName: input.displayName.trim(),
    kind: input.kind,
    acContentSlug: input.acContentSlug.trim(),
    versionLabel: input.versionLabel.trim() || 'library',
    sizeBytes: input.sizeBytes,
    sha256: input.contentHash.toLowerCase(),
    storageKey,
    manifest,
    storageOrigin: 's3_canonical',
    sourceEdgeId: null,
  });

  // Ensure s3* survived ON CONFLICT preserve logic when re-registering same hash.
  // createPackageAndArtifact may keep old s3Key; if missing, merge our fields.
  const { getArtifactById, mergeArtifactManifestS3 } = await import('./catalogRepo.js');
  const art = await getArtifactById(artifactId);
  if (art && !readModS3Fields(art.manifest_json)) {
    await mergeArtifactManifestS3(artifactId, {
      s3Key: s3.s3Key,
      s3Sha256: s3.s3Sha256,
      s3SizeBytes: s3.s3SizeBytes,
      s3Format: MOD_S3_FORMAT_TAR_GZ,
    });
  }

  let hostCatalogSynced = false;
  let hostCatalogSyncError: string | undefined;
  try {
    const sync = await syncHostCatalogUpsert({
      kind: input.kind,
      displayName: input.displayName.trim(),
      acContentSlug: input.acContentSlug.trim(),
      manifest,
      zipPaths: manifest.entryPaths,
    });
    hostCatalogSynced = sync.synced;
    if (!sync.synced) {
      hostCatalogSyncError = sync.error;
    }
  } catch (err: unknown) {
    hostCatalogSyncError = err instanceof Error ? err.message : String(err);
  }

  return {
    packageId,
    artifactId,
    hostCatalogSynced,
    ...(hostCatalogSyncError ? { hostCatalogSyncError } : {}),
  };
}
