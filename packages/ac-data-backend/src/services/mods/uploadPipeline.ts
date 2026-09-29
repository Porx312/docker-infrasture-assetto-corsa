import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModKind } from '@projectd/ac-data-shared/mods/types.js';
import {
  createPackageAndArtifact,
  createUploadSession,
  getUploadSession,
  updateUploadSession,
} from './catalogRepo.js';
import { sha256File, fileSizeBytes } from './hashUtil.js';
import {
  assertManifestMatchesKind,
  buildManifestFromZip,
  defaultAcSlugFromManifest,
  metadataFromZipFilename,
} from './manifestExtract.js';
import { putArtifactFromFile } from './objectStorage.js';
import { distributeArtifact } from './orchestrator.js';
import { resolveModUploadRoot } from './modPaths.js';
import { syncHostCatalogUpsert } from '../hostCatalog/index.js';

export async function beginModUpload(originalName: string, stagingPath: string): Promise<string> {
  const uploadId = randomUUID();
  await createUploadSession(uploadId, originalName, stagingPath);
  return uploadId;
}

export type FinalizeModUploadInput = {
  uploadId: string;
  kind: ModKind;
  displayName?: string;
  versionLabel?: string;
  packageSlug?: string;
  acContentSlug?: string;
  distributeTo?: string[] | 'all' | 'none';
};

export async function finalizeModUpload(input: FinalizeModUploadInput): Promise<{
  packageId: string;
  artifactId: string;
  sha256: string;
  enqueued: number;
}> {
  const session = await getUploadSession(input.uploadId);
  if (!session) {
    throw new Error('Upload session not found');
  }
  const stagingPath = String(session.staging_path);
  await updateUploadSession(input.uploadId, { state: 'processing' });

  const stagingStat = await fs.stat(stagingPath).catch(() => null);
  if (!stagingStat || stagingStat.size < 22) {
    throw new Error('Upload missing or too small. Drop the ZIP again or use Choose ZIP.');
  }

  const sha256 = await sha256File(stagingPath);
  const sizeBytes = await fileSizeBytes(stagingPath);
  const kind = input.kind;
  const manifest = await buildManifestFromZip(stagingPath, kind);
  assertManifestMatchesKind(manifest, kind);

  const originalName = String(session.original_name || 'mod.zip');
  const inferred = metadataFromZipFilename(originalName);
  const displayName = (input.displayName?.trim() || inferred.displayName).trim();
  const versionLabel = (input.versionLabel?.trim() || inferred.versionLabel).trim();
  const slug = input.packageSlug?.trim() || inferred.packageSlug;
  const acContentSlug =
    input.acContentSlug?.trim() || defaultAcSlugFromManifest(manifest, slug.replace(/-/g, '_'));

  const storageKey = await putArtifactFromFile(stagingPath, sha256);
  const { packageId, artifactId } = await createPackageAndArtifact({
    slug,
    displayName,
    kind,
    acContentSlug,
    versionLabel,
    sizeBytes,
    sha256,
    storageKey,
    manifest,
  });

  await updateUploadSession(input.uploadId, { state: 'completed' });
  await fs.unlink(stagingPath).catch(() => undefined);

  let enqueued = 0;
  if (input.distributeTo && input.distributeTo !== 'none') {
    const result = await distributeArtifact(artifactId, input.distributeTo);
    enqueued = result.enqueued;
  }

  await syncHostCatalogUpsert({
    kind,
    displayName,
    acContentSlug,
    manifest,
    zipPaths: manifest.entryPaths,
  });

  return { packageId, artifactId, sha256, enqueued };
}

export function modStagingDir(): string {
  return path.join(resolveModUploadRoot(), 'staging');
}
