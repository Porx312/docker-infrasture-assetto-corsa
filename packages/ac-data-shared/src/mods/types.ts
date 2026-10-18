export type ModKind = 'car' | 'track' | 'weather' | 'misc';

export type EdgeArtifactStatus =
  | 'NOT_INSTALLED'
  | 'PENDING'
  | 'SYNCING'
  | 'READY'
  | 'OUTDATED'
  | 'ERROR';

export type SyncJobOperation = 'install' | 'upgrade' | 'remove' | 'verify';

export type SyncJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type ModManifest = {
  acContentSlugs: string[];
  kind: ModKind;
  rootPaths: string[];
  contentTypeFolder?: 'cars' | 'tracks' | 'weather';
  /** All zip entry paths (for skins / track layouts). Optional for older rows. */
  entryPaths?: string[];
  /**
   * Optional Contabo/S3 canonical server-slim tar.gz (Phase 1).
   * Present only after successful promote; storage_origin stays edge_folder.
   */
  s3Key?: string;
  /** SHA-256 of the exact object bytes on S3 (not the tree contentHash). */
  s3Sha256?: string;
  s3SizeBytes?: number;
  /** Must be server-slim-tar-gz when s3Key is set. */
  s3Format?: string;
};

export type DesiredArtifactRow = {
  artifactId: string;
  packageId: string;
  sha256: string;
  storageKey: string;
  sizeBytes: number;
  operation: SyncJobOperation;
  acContentSlug: string;
  kind: ModKind;
  manifest: ModManifest;
};

export type ModAgentJobPayload = {
  jobId: string;
  edgeId: string;
  artifactId: string;
  operation: SyncJobOperation;
  sha256: string;
  storageKey: string;
  sizeBytes: number;
  acContentSlug: string;
  manifest: ModManifest;
  /** Optional version label from central library (for local inventory sidecar). */
  versionLabel?: string;
  /**
   * Folder-first peer pull: tar stream of CONTENT_PATH/{cars|tracks|weather}/slug.
   * Auth: agent sends X-Worker-Secret. Emergency mesh when MOD_PEER_PULL_ENABLED=1.
   */
  treeDownloadUrl?: string;
  /**
   * Canonical S3 pull (presigned GET of server-slim tar.gz).
   * Used when peer tree is unavailable and manifest has validated s3Key.
   */
  s3DownloadUrl?: string;
  /** SHA-256 of the tar.gz object (file integrity). Tree contentHash remains sha256. */
  s3ObjectSha256?: string;
  s3ObjectSizeBytes?: number;
};

export type InventoryReportItem = {
  artifactId: string;
  sha256: string;
  status: EdgeArtifactStatus;
  bytesOnDisk?: number;
};
