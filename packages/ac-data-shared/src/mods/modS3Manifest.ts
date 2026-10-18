/**
 * Optional Contabo/S3 canonical blob refs on artifact.manifest_json.
 * Does not change storage_origin (remains edge_folder). Validated before use.
 */

export const MOD_S3_FORMAT_TAR_GZ = 'server-slim-tar-gz' as const;

export type ModS3ManifestFields = {
  s3Key: string;
  s3Sha256: string;
  s3SizeBytes: number;
  s3Format: typeof MOD_S3_FORMAT_TAR_GZ;
};

const S3_KEY_RE = /^artifacts\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}\.tar\.gz$/i;
const SHA_RE = /^[a-f0-9]{64}$/i;

export function artifactTarGzStorageKey(contentHashSha256: string): string {
  const h = contentHashSha256.toLowerCase();
  return `artifacts/sha256/${h.slice(0, 2)}/${h.slice(2, 4)}/${h}.tar.gz`;
}

export function readModS3Fields(manifest: unknown): ModS3ManifestFields | null {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null;
  }
  const m = manifest as Record<string, unknown>;
  const s3Key = typeof m.s3Key === 'string' ? m.s3Key.trim() : '';
  const s3Sha256 = typeof m.s3Sha256 === 'string' ? m.s3Sha256.trim().toLowerCase() : '';
  const s3Format = typeof m.s3Format === 'string' ? m.s3Format.trim() : '';
  const s3SizeBytes = Number(m.s3SizeBytes);
  if (!s3Key || !S3_KEY_RE.test(s3Key)) return null;
  if (!SHA_RE.test(s3Sha256)) return null;
  if (s3Format !== MOD_S3_FORMAT_TAR_GZ) return null;
  if (!Number.isFinite(s3SizeBytes) || s3SizeBytes <= 0) return null;
  return {
    s3Key,
    s3Sha256,
    s3SizeBytes: Math.trunc(s3SizeBytes),
    s3Format: MOD_S3_FORMAT_TAR_GZ,
  };
}

export function mergeModS3FieldsIntoManifest<T extends Record<string, unknown>>(
  manifest: T,
  fields: ModS3ManifestFields,
): T & ModS3ManifestFields {
  return {
    ...manifest,
    s3Key: fields.s3Key,
    s3Sha256: fields.s3Sha256,
    s3SizeBytes: fields.s3SizeBytes,
    s3Format: fields.s3Format,
  };
}

/** Hub feature flags. Default off → legacy peer-only behavior. */
export function isModS3CanonicalUploadEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.MOD_S3_CANONICAL_UPLOAD || '').trim() === '1';
}

export function isModS3PullEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MOD_S3_PULL_ENABLED || '').trim() === '1';
}
