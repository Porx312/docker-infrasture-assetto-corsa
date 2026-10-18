/** Edge-owned storage keys (folder-first CONTENT_PATH; no ZIP blobs). */

/** Folder-first: content lives under CONTENT_PATH; hub only indexes metadata. */
const EDGE_FOLDER_KEY_RE =
  /^edge-folder:([^:]+):(car|track|weather):([^:]+):([a-f0-9]{64})$/i;

export type EdgeFolderKind = 'car' | 'track' | 'weather';

export function edgeFolderStorageKey(
  edgeId: string,
  kind: EdgeFolderKind,
  slug: string,
  contentHash: string,
): string {
  const id = edgeId.trim().toLowerCase();
  const s = slug.trim();
  const h = contentHash.trim().toLowerCase();
  return `edge-folder:${id}:${kind}:${s}:${h}`;
}

export function parseEdgeFolderStorageKey(storageKey: string): {
  edgeId: string;
  kind: EdgeFolderKind;
  slug: string;
  contentHash: string;
} | null {
  const m = EDGE_FOLDER_KEY_RE.exec(storageKey.trim());
  if (!m?.[1] || !m[2] || !m[3] || !m[4]) {
    return null;
  }
  return {
    edgeId: m[1].toLowerCase(),
    kind: m[2].toLowerCase() as EdgeFolderKind,
    slug: m[3],
    contentHash: m[4].toLowerCase(),
  };
}

export function isEdgeFolderStorageKey(storageKey: string): boolean {
  return parseEdgeFolderStorageKey(storageKey) !== null;
}

/** Edge-owned folder-first key (ZIP `edge:` keys removed). */
export function isEdgeOwnedStorageKey(storageKey: string): boolean {
  return isEdgeFolderStorageKey(storageKey);
}
