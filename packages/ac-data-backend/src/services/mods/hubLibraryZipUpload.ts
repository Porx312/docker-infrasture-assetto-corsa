/**
 * Control API: Host uploads a full car/track ZIP; hub does slim filter + hash + S3 + steam link.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import unzipper from 'unzipper';
import {
  hashContentTree,
  listContentTreeRelPaths,
} from '@projectd/ac-data-shared/mods/contentTreeHash.js';
import {
  isServerSlimRelativePath,
  type ServerSlimKind,
} from '@projectd/ac-data-shared/mods/serverSlimPaths.js';
import {
  artifactTarGzStorageKey,
  MOD_S3_FORMAT_TAR_GZ,
} from '@projectd/ac-data-shared/mods/modS3Manifest.js';
import { headCanonicalObject, putCanonicalTarGz, storageMode } from './objectStorage.js';
import { registerS3LibraryArtifact } from './s3LibraryRegister.js';
import {
  findLibraryByContentHash,
  packSlimTarGz,
} from './hubLibrarySlimUpload.js';
import {
  isValidSteam64,
  normalizeSteamId,
  skinsFromManifest,
  upsertModSteamLink,
} from './modSteamLinks.js';
import { extractCarSkinsFromZipPaths } from '../hostCatalog/index.js';
import { getArtifactById } from './catalogRepo.js';

type MulterFile = {
  path: string;
  originalname: string;
  size: number;
  mimetype: string;
};

function controlMaxBytes(): number {
  return Number(process.env.CONTROL_MOD_UPLOAD_MAX_BYTES || 500 * 1024 * 1024);
}

function controlMaxFiles(): number {
  return Number(process.env.CONTROL_MOD_UPLOAD_MAX_FILES || 5000);
}

function contentFolder(kind: 'car' | 'track'): 'cars' | 'tracks' {
  return kind === 'car' ? 'cars' : 'tracks';
}

function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function isUnsafeZipEntryPath(entryPath: string): boolean {
  const n = entryPath.replace(/\\/g, '/');
  if (!n || n.includes('\0')) return true;
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return true;
  const parts = n.split('/');
  return parts.some((p) => p === '..');
}

/** Extract ZIP into destDir; rejects path traversal. Returns extracted file count. */
export async function extractZipSafe(zipPath: string, destDir: string): Promise<number> {
  await fsp.mkdir(destDir, { recursive: true });
  const zip = await unzipper.Open.file(zipPath);
  const entries = zip.files || [];
  let count = 0;
  for (const entry of entries) {
    const entryPath = String(entry.path || '');
    if (!entryPath.trim()) continue;
    const normalizedPath = entryPath.replace(/\\/g, '/');
    if (isUnsafeZipEntryPath(normalizedPath)) {
      throw new Error(`unsafe_zip_path: ${normalizedPath}`);
    }
    const isDir = Boolean(
      (entry as { type?: string; isDirectory?: boolean }).type === 'Directory' ||
        (entry as { isDirectory?: boolean }).isDirectory ||
        normalizedPath.endsWith('/'),
    );
    const targetPath = path.join(destDir, normalizedPath);
    const relative = path.relative(destDir, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`unsafe_zip_path: ${normalizedPath}`);
    }
    if (isDir) {
      await fsp.mkdir(targetPath, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(entry.stream(), createWriteStream(targetPath));
    count += 1;
    if (count > controlMaxFiles() * 4) {
      throw new Error('zip_too_many_entries');
    }
  }
  return count;
}

/**
 * Find cars/<slug> or tracks/<slug> or single top-level folder or flat data.acd root.
 */
export async function resolveContentRoot(
  extractDir: string,
  kind: 'car' | 'track',
  slugHint?: string,
): Promise<{ contentRoot: string; slug: string }> {
  const folder = contentFolder(kind);
  const prefixed = path.join(extractDir, folder);
  if (fs.existsSync(prefixed)) {
    const kids = (await fsp.readdir(prefixed, { withFileTypes: true })).filter((d) =>
      d.isDirectory(),
    );
    if (slugHint) {
      const hintDir = path.join(prefixed, slugHint);
      if (fs.existsSync(hintDir)) {
        return { contentRoot: hintDir, slug: sanitizeSlug(slugHint) };
      }
    }
    if (kids.length === 1 && kids[0]) {
      return { contentRoot: path.join(prefixed, kids[0].name), slug: sanitizeSlug(kids[0].name) };
    }
    if (kids.length > 1) {
      throw new Error(`ambiguous_content_root: multiple folders under ${folder}/`);
    }
  }

  const top = (await fsp.readdir(extractDir, { withFileTypes: true })).filter(
    (d) => !d.name.startsWith('.') && d.name !== '__MACOSX',
  );
  const dirs = top.filter((d) => d.isDirectory());
  const files = top.filter((d) => d.isFile());

  if (dirs.length === 1 && files.length === 0 && dirs[0]) {
    const name = dirs[0].name;
    const nested = path.join(extractDir, name);
    if (name === 'content') {
      return resolveContentRoot(nested, kind, slugHint);
    }
    if (name === folder) {
      // ZIP root is only cars/ or tracks/ — resolve slug under it
      const kids = (await fsp.readdir(nested, { withFileTypes: true })).filter((d) =>
        d.isDirectory(),
      );
      if (slugHint) {
        const hintDir = path.join(nested, slugHint);
        if (fs.existsSync(hintDir)) {
          return { contentRoot: hintDir, slug: sanitizeSlug(slugHint) };
        }
      }
      if (kids.length === 1 && kids[0]) {
        return { contentRoot: path.join(nested, kids[0].name), slug: sanitizeSlug(kids[0].name) };
      }
      throw new Error(`ambiguous_content_root: multiple folders under ${folder}/`);
    }
    return {
      contentRoot: nested,
      slug: sanitizeSlug(slugHint || name),
    };
  }

  // Flat: data.acd at extract root
  if (kind === 'car' && fs.existsSync(path.join(extractDir, 'data.acd'))) {
    const slug = sanitizeSlug(slugHint || 'custom_car');
    if (!slug) throw new Error('slug_required');
    return { contentRoot: extractDir, slug };
  }

  if (slugHint) {
    const hint = path.join(extractDir, slugHint);
    if (fs.existsSync(hint)) {
      return { contentRoot: hint, slug: sanitizeSlug(slugHint) };
    }
  }

  throw new Error('content_root_not_found');
}

/** Copy slim-only files into destSlugDir (basename must be slug). */
export async function materializeSlimTree(
  contentRoot: string,
  kind: ServerSlimKind,
  destSlugDir: string,
): Promise<string[]> {
  const rels = await listContentTreeRelPaths(contentRoot, { slimKind: kind });
  if (rels.length === 0) {
    throw new Error('no_slim_files');
  }
  if (rels.length > controlMaxFiles()) {
    throw new Error(`too_many_slim_files: ${rels.length}`);
  }
  await fsp.rm(destSlugDir, { recursive: true, force: true });
  await fsp.mkdir(destSlugDir, { recursive: true });
  let totalBytes = 0;
  for (const rel of rels) {
    if (!isServerSlimRelativePath(rel, kind)) continue;
    const src = path.join(contentRoot, ...rel.split('/'));
    const dest = path.join(destSlugDir, ...rel.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    totalBytes += (await fsp.stat(dest)).size;
    if (totalBytes > controlMaxBytes()) {
      throw new Error('slim_tree_too_large');
    }
  }
  return rels;
}

export type ZipUploadResult = {
  ok: true;
  status: 'already_present' | 'uploaded';
  packageId: string;
  artifactId: string;
  contentHash: string;
  kind: string;
  acContentSlug: string;
  displayName: string;
  s3Key: string | null;
  linked: true;
  steamId: string;
  hostCatalogSynced: boolean;
  skins: string[];
};

export async function processLibraryZipUpload(input: {
  zipPath: string;
  steamId: string;
  kind: 'car' | 'track';
  slug?: string;
  displayName?: string;
}): Promise<ZipUploadResult> {
  if (storageMode() !== 's3') {
    throw new Error('s3_required');
  }
  const steamId = normalizeSteamId(input.steamId);
  if (!isValidSteam64(steamId)) {
    throw new Error('invalid_steam_id');
  }

  const workRoot = path.join(
    process.env.ADMIN_UPLOAD_DIR || os.tmpdir(),
    'hub-library-zip',
    crypto.randomBytes(12).toString('hex'),
  );
  const extractDir = path.join(workRoot, 'extract');
  try {
    await extractZipSafe(input.zipPath, extractDir);
    const { contentRoot, slug } = await resolveContentRoot(
      extractDir,
      input.kind,
      input.slug ? sanitizeSlug(input.slug) : undefined,
    );
    if (!slug) {
      throw new Error('slug_required');
    }
    const displayName =
      typeof input.displayName === 'string' && input.displayName.trim()
        ? input.displayName.trim()
        : slug;

    const slimDir = path.join(workRoot, 'slim', slug);
    const entryPaths = await materializeSlimTree(contentRoot, input.kind, slimDir);
    const verified = await hashContentTree(slimDir, { slimKind: input.kind });

    const skinsFromZip =
      input.kind === 'car' ? extractCarSkinsFromZipPaths(entryPaths, slug) : [];

    const existing = await findLibraryByContentHash(verified.contentHash);
    if (existing) {
      await upsertModSteamLink(steamId, existing.packageId);
      let skins = skinsFromZip;
      if (skins.length === 0 && existing.kind === 'car') {
        const art = await getArtifactById(existing.artifactId);
        skins = skinsFromManifest(
          existing.kind,
          existing.acContentSlug,
          art?.manifest_json,
        );
      }
      return {
        ok: true,
        status: 'already_present',
        packageId: existing.packageId,
        artifactId: existing.artifactId,
        contentHash: verified.contentHash,
        kind: existing.kind,
        acContentSlug: existing.acContentSlug,
        displayName: existing.displayName,
        s3Key: existing.s3Key,
        linked: true,
        steamId,
        hostCatalogSynced: false,
        skins,
      };
    }

    const gzPath = path.join(workRoot, 'slim.tar.gz');
    const packed = await packSlimTarGz(slimDir, slug, gzPath);
    const key = artifactTarGzStorageKey(verified.contentHash);
    const put = await putCanonicalTarGz({
      key,
      filePath: gzPath,
      contentHash: verified.contentHash,
      objectSha256: packed.objectSha256,
      sizeBytes: packed.sizeBytes,
    });
    if (put.status === 'skipped_not_s3_mode') {
      throw new Error('s3_required');
    }

    let finalSha = packed.objectSha256;
    let finalSize = packed.sizeBytes;
    if (put.status === 'already_exists') {
      const head = await headCanonicalObject(key);
      if (!head.exists) {
        throw new Error('s3_head_missing');
      }
      const metaSha = head.metadata?.['object-sha256'] || head.metadata?.objectsha256;
      if (metaSha && /^[a-f0-9]{64}$/i.test(metaSha)) {
        finalSha = metaSha.toLowerCase();
      }
      if (typeof head.contentLength === 'number' && head.contentLength > 0) {
        finalSize = head.contentLength;
      }
    }

    const registered = await registerS3LibraryArtifact({
      slug,
      displayName,
      kind: input.kind,
      acContentSlug: slug,
      versionLabel: new Date().toISOString().slice(0, 10),
      contentHash: verified.contentHash,
      sizeBytes: verified.sizeBytes,
      manifest: {
        kind: input.kind,
        acContentSlugs: [slug],
        rootPaths: [`${contentFolder(input.kind)}/${slug}`],
        contentTypeFolder: contentFolder(input.kind),
        entryPaths: entryPaths.slice(0, 50_000),
      },
      s3: {
        s3Key: key,
        s3Sha256: finalSha,
        s3SizeBytes: finalSize,
        s3Format: MOD_S3_FORMAT_TAR_GZ,
      },
      syncHostCatalog: false,
    });

    await upsertModSteamLink(steamId, registered.packageId);

    return {
      ok: true,
      status: 'uploaded',
      packageId: registered.packageId,
      artifactId: registered.artifactId,
      contentHash: verified.contentHash,
      kind: input.kind,
      acContentSlug: slug,
      displayName,
      s3Key: key,
      linked: true,
      steamId,
      hostCatalogSynced: registered.hostCatalogSynced === true,
      skins: skinsFromZip,
    };
  } finally {
    void fsp.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function handleLibraryZipUpload(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: MulterFile }).file;
  if (!file?.path) {
    res.status(400).json({ ok: false, message: 'file required (multipart field "file")' });
    return;
  }

  const steamId = normalizeSteamId(req.body?.steamId ?? req.body?.steam_id);
  const kindRaw = String(req.body?.kind || '')
    .trim()
    .toLowerCase();
  const kind = kindRaw === 'car' || kindRaw === 'track' ? kindRaw : '';
  const slug =
    typeof req.body?.slug === 'string' && req.body.slug.trim()
      ? sanitizeSlug(req.body.slug)
      : undefined;
  const displayName =
    typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;

  if (!isValidSteam64(steamId)) {
    void fsp.unlink(file.path).catch(() => undefined);
    res.status(400).json({ ok: false, message: 'steamId required (Steam64)' });
    return;
  }
  if (!kind) {
    void fsp.unlink(file.path).catch(() => undefined);
    res.status(400).json({ ok: false, message: 'kind must be car|track' });
    return;
  }
  if (file.size > controlMaxBytes()) {
    void fsp.unlink(file.path).catch(() => undefined);
    res.status(400).json({ ok: false, message: `zip too large (max ${controlMaxBytes()} bytes)` });
    return;
  }

  try {
    const result = await processLibraryZipUpload({
      zipPath: file.path,
      steamId,
      kind,
      slug,
      displayName,
    });
    res.json({
      ...result,
      message:
        result.status === 'already_present'
          ? 'Mod already in library; linked to steamId'
          : 'Uploaded ZIP to library and linked to steamId',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[library-zip] ${message}`);
    if (message === 's3_required') {
      res.status(503).json({ ok: false, message: 'MOD_STORAGE_MODE=s3 required' });
      return;
    }
    if (
      message.startsWith('unsafe_zip_path') ||
      message === 'content_root_not_found' ||
      message === 'no_slim_files' ||
      message.startsWith('ambiguous_') ||
      message.startsWith('too_many') ||
      message === 'slim_tree_too_large' ||
      message === 'zip_too_many_entries' ||
      message === 'slug_required' ||
      message === 'invalid_steam_id'
    ) {
      res.status(400).json({ ok: false, message });
      return;
    }
    res.status(500).json({ ok: false, message });
  } finally {
    void fsp.unlink(file.path).catch(() => undefined);
  }
}

/** Test helper: path traversal check. */
export function _isUnsafeZipEntryPathForTests(p: string): boolean {
  return isUnsafeZipEntryPath(p);
}
