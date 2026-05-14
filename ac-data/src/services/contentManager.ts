import fs from 'fs';
import path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import unzipper from 'unzipper';
import dotenv from 'dotenv';

dotenv.config({ path: '/home/jose/assetto-infra/.env' });

const CONTENT_BASE_PATH = process.env.CONTENT_PATH || '/home/jose/assetto-install/assetto/content';

export type ContentType = 'cars' | 'tracks' | 'weather';

export interface ContentItem {
    name: string;
    path: string;
    size: number;
    modified: Date;
    isDirectory: boolean;
}

const ALLOWED_EXTENSIONS: Record<ContentType, string[]> = {
    cars: ['.kn5', '.acd', '.ini', '.zip'],
    tracks: ['.kn5', '.acd', '.ini', '.zip'],
    weather: ['.ini', '.zip'],
};

function getContentDir(type: ContentType): string {
    return path.join(CONTENT_BASE_PATH, type);
}

function isAllowedFile(filePath: string, type: ContentType): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext || ext.length === 0) return false;
    const allowed = ALLOWED_EXTENSIONS[type] || [];
    return allowed.includes(ext);
}

export async function listContent(type: ContentType): Promise<ContentItem[]> {
    const contentDir = getContentDir(type);

    if (!fs.existsSync(contentDir)) {
        return [];
    }

    const entries = await fs.promises.readdir(contentDir, { withFileTypes: true });
    const items: ContentItem[] = [];

    for (const entry of entries) {
        const fullPath = path.join(contentDir, entry.name);
        try {
            const stats = await fs.promises.stat(fullPath);
            items.push({
                name: entry.name,
                path: fullPath,
                size: stats.size,
                modified: stats.mtime,
                isDirectory: entry.isDirectory(),
            });
        } catch {
            items.push({
                name: entry.name,
                path: fullPath,
                size: 0,
                modified: new Date(),
                isDirectory: entry.isDirectory(),
            });
        }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getContentSummary(): Promise<Record<ContentType, { count: number; items: ContentItem[] }>> {
    const types: ContentType[] = ['cars', 'tracks', 'weather'];
    const summary: Record<string, any> = {};

    for (const type of types) {
        const items = await listContent(type);
        summary[type] = {
            count: items.length,
            items: items.slice(0, 10),
        };
    }

    return summary as Record<ContentType, { count: number; items: ContentItem[] }>;
}

export async function deleteContent(type: ContentType, name: string): Promise<{ ok: boolean; message: string }> {
    const contentDir = getContentDir(type);
    const targetPath = path.join(contentDir, name);

    if (!targetPath.startsWith(contentDir)) {
        return { ok: false, message: 'Invalid path' };
    }

    if (!fs.existsSync(targetPath)) {
        return { ok: false, message: 'Item not found' };
    }

    try {
        const stats = await fs.promises.stat(targetPath);
        if (stats.isDirectory()) {
            await fs.promises.rm(targetPath, { recursive: true });
        } else {
            await fs.promises.unlink(targetPath);
        }
        return { ok: true, message: `Deleted ${name}` };
    } catch (err: any) {
        return { ok: false, message: err.message };
    }
}

export async function uploadSingleFile(type: ContentType, file: Express.Multer.File): Promise<{ ok: boolean; message: string }> {
    const contentDir = getContentDir(type);
    const targetPath = path.join(contentDir, file.originalname);

    if (!targetPath.startsWith(contentDir)) {
        return { ok: false, message: 'Invalid path' };
    }

    if (!isAllowedFile(file.originalname, type)) {
        return { ok: false, message: `File type not allowed: ${path.extname(file.originalname)}` };
    }

    try {
        await fs.promises.copyFile(file.path, targetPath);
        await fs.promises.unlink(file.path);
        return { ok: true, message: `Uploaded ${file.originalname}` };
    } catch (err: any) {
        return { ok: false, message: err.message };
    }
}

export async function extractZip(type: ContentType, zipPath: string): Promise<{ ok: boolean; message: string; extracted: string[]; errors: string[] }> {
    const contentDir = getContentDir(type);
    const extracted: string[] = [];
    const errors: string[] = [];

    console.log(`[extractZip] Starting extraction for type: ${type}, zip: ${zipPath}`);
    console.log(`[extractZip] Content dir: ${contentDir}`);

    const normalizedZipPath = path.normalize(zipPath);
    if (normalizedZipPath.includes('..')) {
        console.log(`[extractZip] Unsafe zip path (contains ..)`);
        return { ok: false, message: 'Invalid zip path', extracted: [], errors: [] };
    }

    try {
        console.log(`[extractZip] Opening zip file...`);
        const zip = await unzipper.Open.file(zipPath);
        const entries = (zip as any).files || [];
        console.log(`[extractZip] Found ${entries.length} entries in zip`);

        for (const entry of entries) {
            try {
                if (entry.isDirectory) {
                    console.log(`[extractZip] Skipping directory: ${entry.path}`);
                    continue;
                }

                const entryPath = entry.path;
                if (!entryPath || entryPath.trim() === '') {
                    console.log(`[extractZip] Skipping empty path entry`);
                    continue;
                }

                const normalizedPath = entryPath.replace(/\\/g, '/');
                const targetDir = path.join(contentDir, path.dirname(normalizedPath));
                const targetPath = path.join(contentDir, normalizedPath);

                const relativePath = path.relative(contentDir, targetPath);
                if (relativePath.startsWith('..') || relativePath.includes('..')) {
                    console.log(`[extractZip] Skipping unsafe path: ${normalizedPath}`);
                    continue;
                }

                if (!fs.existsSync(targetDir)) {
                    await fs.promises.mkdir(targetDir, { recursive: true });
                }

                if (entry.isDirectory) {
                    await fs.promises.mkdir(targetPath, { recursive: true });
                } else {
                    const entryStream = entry.stream();
                    const writeStream = createWriteStream(targetPath);
                    await pipeline(entryStream, writeStream);
                    extracted.push(normalizedPath);
                    console.log(`[extractZip] Extracted: ${normalizedPath}`);
                }
            } catch (err: any) {
                console.error(`[extractZip] Failed to extract ${entry?.path}: ${err.message}`);
                errors.push(`Failed to extract ${entry?.path}: ${err.message}`);
            }
        }

        await fs.promises.unlink(zipPath).catch(() => {});
        console.log(`[extractZip] Done. Extracted: ${extracted.length}, Errors: ${errors.length}`);
        return {
            ok: true,
            message: `Extracted ${extracted.length} files${errors.length > 0 ? ` with ${errors.length} errors` : ''}`,
            extracted,
            errors
        };
    } catch (err: any) {
        console.error(`[extractZip] Failed to open zip: ${err.message}`);
        return { ok: false, message: err.message, extracted: [], errors: [] };
    }
}

export function getContentPath(type: ContentType): string {
    return getContentDir(type);
}