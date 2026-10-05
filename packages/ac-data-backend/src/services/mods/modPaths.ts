import fs from 'node:fs';
import path from 'node:path';

function canWriteUnder(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Hub mod storage root: Fleet→edge upload staging + leftover master blobs. */
export function resolveModUploadRoot(): string {
  const explicit = (process.env.MOD_UPLOAD_ROOT || '').trim();
  const contentPath = (process.env.CONTENT_PATH || '').trim();
  const siblingFromContent = contentPath ? path.join(path.dirname(contentPath), 'mods') : '';

  if (explicit) {
    if (canWriteUnder(path.join(explicit, 'staging'))) {
      return explicit;
    }
    if (siblingFromContent && canWriteUnder(path.join(siblingFromContent, 'staging'))) {
      console.warn(
        `[mods] MOD_UPLOAD_ROOT=${explicit} is not writable on this host; using ${siblingFromContent}`,
      );
      return siblingFromContent;
    }
    return explicit;
  }

  if (siblingFromContent && canWriteUnder(path.join(siblingFromContent, 'staging'))) {
    return siblingFromContent;
  }

  const fallback = '/var/lib/ac-data/mod-uploads';
  if (canWriteUnder(path.join(fallback, 'staging'))) {
    return fallback;
  }

  return siblingFromContent || fallback;
}

export function resolveModMasterLocalPath(uploadRoot: string): string {
  const explicit = (process.env.MOD_MASTER_LOCAL_PATH || '').trim();
  return explicit || path.join(uploadRoot, 'master');
}

export function ensureModStagingDir(): string {
  const staging = path.join(resolveModUploadRoot(), 'staging');
  fs.mkdirSync(staging, { recursive: true });
  return staging;
}
