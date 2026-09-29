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
};

export type InventoryReportItem = {
  artifactId: string;
  sha256: string;
  status: EdgeArtifactStatus;
  bytesOnDisk?: number;
};
