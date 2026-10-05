/** Edge-owned blob storage keys (no hub master ZIP). */

const EDGE_KEY_RE = /^edge:([^:]+):([a-f0-9]{64})$/i;

export function edgeBlobStorageKey(edgeId: string, sha256: string): string {
  return `edge:${edgeId.trim().toLowerCase()}:${sha256.trim().toLowerCase()}`;
}

export function parseEdgeBlobStorageKey(
  storageKey: string,
): { edgeId: string; sha256: string } | null {
  const m = EDGE_KEY_RE.exec(storageKey.trim());
  if (!m?.[1] || !m[2]) {
    return null;
  }
  return { edgeId: m[1].toLowerCase(), sha256: m[2].toLowerCase() };
}

export function isEdgeBlobStorageKey(storageKey: string): boolean {
  return parseEdgeBlobStorageKey(storageKey) !== null;
}
