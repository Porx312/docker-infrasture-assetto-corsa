import fs from 'fs';
import path from 'path';

const CONTENT_EXTENSIONS = new Set(['.acd', '.kn5']);

function isContentExtension(fileName: string): boolean {
  return CONTENT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Walk directory tree; return whether any .acd or .kn5 exists. */
export async function modHasContentFiles(dirPath: string): Promise<{ hasAcd: boolean; hasKn5: boolean; fileCount: number }> {
  let hasAcd = false;
  let hasKn5 = false;
  let fileCount = 0;

  async function walk(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      fileCount += 1;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.acd') hasAcd = true;
      if (ext === '.kn5') hasKn5 = true;
    }
  }

  await walk(dirPath);
  return { hasAcd, hasKn5, fileCount };
}

/** True when no .acd and no .kn5 anywhere under the mod path. */
export async function isEmptyMod(modPath: string, isDirectory: boolean): Promise<boolean> {
  if (!isDirectory) {
    const ext = path.extname(modPath).toLowerCase();
    return !isContentExtension(path.basename(modPath)) && ext !== '.acd' && ext !== '.kn5';
  }
  const { hasAcd, hasKn5 } = await modHasContentFiles(modPath);
  return !hasAcd && !hasKn5;
}
