import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import {
    generateToken,
    getAdminCredentials,
    verifyToken,
    ADMIN_TOKEN_COOKIE_OPTIONS,
} from '../middleware/adminAuth.js';
import { listContent, deleteContent, uploadSingleFile, extractZip, getContentSummary, type ContentType } from '../services/contentManager.js';
import {
    listContentVariants,
    previewContentType,
    resolveVariantPreviewPath,
} from '../services/contentPreviews.js';
import {
    buildCmDescription,
    normalizeBranding,
    readServerBranding,
    saveAndApplyBranding,
    summarizeServers,
} from '../services/serverBranding.js';
import {
    readServerInstanceConfig,
    updateServerInstanceConfig,
} from '../services/serverInstanceConfig.js';
import { getServerRuntime } from '../services/serverRuntime.js';
import {
    deleteHudRelease,
    listHudReleases,
    resolveHudReleasePath,
    uploadHudRelease,
} from '../services/projectdHudManager.js';
import { deleteEmptyContent, parseSyncContentType } from '../services/contentAdminHelpers.js';
import {
  proxyFleetAdminIfNeeded,
  readFleetEdgeIdFromRequest,
} from '../services/fleet/fleetAdminBridge.js';
import { isFleetModeEnabled } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { isHubOwnsContent } from '../services/fleet/hubFleetConfig.js';
import {
  deleteBrandingImageFile,
  isBrandingImageUploadConfigured,
  listBrandingImages,
  storeBrandingImageFromTemp,
} from '../services/brandingImages.js';

export async function adminLogin(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;

    if (!username || !password) {
        res.status(400).json({ error: 'Bad request', message: 'Username and password required' });
        return;
    }

    const creds = getAdminCredentials();
    if (!creds) {
        res.status(503).json({ error: 'Service unavailable', message: 'Admin credentials not configured' });
        return;
    }

    if (username !== creds.username || password !== creds.password) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
        return;
    }

    const token = generateToken(username);
    res.cookie('admin_token', token, ADMIN_TOKEN_COOKIE_OPTIONS);
    res.json({ ok: true, message: 'Login successful', token });
}

export async function adminLogout(req: Request, res: Response): Promise<void> {
    res.clearCookie('admin_token', {
        httpOnly: ADMIN_TOKEN_COOKIE_OPTIONS.httpOnly,
        secure: ADMIN_TOKEN_COOKIE_OPTIONS.secure,
        sameSite: ADMIN_TOKEN_COOKIE_OPTIONS.sameSite,
        path: ADMIN_TOKEN_COOKIE_OPTIONS.path,
    });
    res.json({ ok: true, message: 'Logged out' });
}

export async function adminCheck(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.admin_token;

    if (!token) {
        res.status(401).json({ authenticated: false });
        return;
    }

    const payload = verifyToken(token);
    if (!payload) {
        res.status(401).json({ authenticated: false });
        return;
    }

    res.json({ authenticated: true, username: payload.username });
}

export async function getContent(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const summary = await getContentSummary();
        res.json({ ok: true, ...summary });
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function getContentItems(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    try {
        const items = await listContent(type);
        if (type === 'cars' || type === 'tracks') {
            const enriched = await Promise.all(
                items.map(async (item) => {
                    if (!item.isDirectory) {
                        return { ...item, variants: [] as { name: string }[] };
                    }
                    const variants = await listContentVariants(type, item.name);
                    return { ...item, variants };
                }),
            );
            res.json({ ok: true, type, items: enriched });
            return;
        }
        res.json({ ok: true, type, items });
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function getContentPreview(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = req.params.type as 'cars' | 'tracks';
    const itemName = String(req.params.name || '');
    const variantName = String(req.params.variant || '');

    if (!['cars', 'tracks'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!itemName || !variantName) {
        res.status(400).json({ error: 'Bad request', message: 'Item and variant name required' });
        return;
    }

    const previewPath = resolveVariantPreviewPath(type, itemName, variantName);
    if (!previewPath) {
        res.status(404).json({ error: 'Not found', message: 'Preview not found' });
        return;
    }

    res.setHeader('Content-Type', previewContentType(previewPath));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(previewPath);
}

export async function deleteContentItem(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = req.params.type as ContentType;
    const name = String(req.params.name || '');

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!name || name.includes('..') || name.includes('/')) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid item name' });
        return;
    }

    try {
        const result = await deleteContent(type, name);
        if (result.ok) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function uploadContent(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!req.file) {
        res.status(400).json({ error: 'Bad request', message: 'No file uploaded' });
        return;
    }

    try {
        const file = req.file;
        let result;

        console.log(`[upload] File: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`);

        if (file.originalname.endsWith('.zip')) {
            result = await extractZip(type, file.path);
            console.log(`[upload] ZIP result:`, result);
        } else {
            result = await uploadSingleFile(type, file);
        }

        res.json(result);
    } catch (err: any) {
        console.error(`[upload] Error:`, err);
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function uploadMultipleContent(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ error: 'Bad request', message: 'No files uploaded' });
        return;
    }

    const results: { file: string; ok: boolean; message: string }[] = [];

    for (const file of req.files) {
        let result;
        if (file.originalname.endsWith('.zip')) {
            result = await extractZip(type, file.path);
        } else {
            result = await uploadSingleFile(type, file);
        }
        results.push({ file: file.originalname, ...result });
    }

    res.json({ ok: true, results });
}

export async function getServerBrandingHandler(req: Request, res: Response): Promise<void> {
    if (
        isFleetModeEnabled() &&
        !readFleetEdgeIdFromRequest(req) &&
        isHubOwnsContent()
    ) {
        try {
            const branding = await readServerBranding();
            const servers = summarizeServers();
            res.json({
                ok: true,
                branding,
                cmDescriptionPreview: buildCmDescription(branding),
                servers,
                serverCount: servers.length,
                hubLocalBranding: true,
            });
            return;
        } catch {
            res.json({
                ok: true,
                branding: normalizeBranding({}),
                cmDescriptionPreview: '',
                servers: [],
                serverCount: 0,
                hubLocalBranding: true,
            });
            return;
        }
    }
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const branding = await readServerBranding();
        const servers = summarizeServers();
        res.json({
            ok: true,
            branding,
            cmDescriptionPreview: buildCmDescription(branding),
            servers,
            serverCount: servers.length,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}

const BRANDING_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Upload loading/banner image to hub data/branding; returns public URL for CM. */
export async function uploadBrandingImageHandler(req: Request, res: Response): Promise<void> {
  if (!isBrandingImageUploadConfigured()) {
    res.status(503).json({
      ok: false,
      message:
        'Branding upload needs HUD_PUBLIC_BASE_URL (or PUBLIC_API_BASE_URL) so players can fetch images',
    });
    return;
  }

  const file = req.file;
  if (!file?.path) {
    res.status(400).json({ ok: false, message: 'file required (multipart field "file")' });
    return;
  }

  const mime = (file.mimetype || '').toLowerCase();
  if (mime && !BRANDING_IMAGE_MIME.has(mime)) {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
    res.status(400).json({ ok: false, message: 'Only JPEG, PNG, WebP, or GIF images are allowed' });
    return;
  }

  try {
    const stored = await storeBrandingImageFromTemp(
      file.path,
      file.originalname || 'image.jpg',
      mime || 'image/jpeg',
    );
    res.json({
      ok: true,
      url: stored.url,
      filename: stored.filename,
    });
  } catch (err: unknown) {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : 'Upload failed';
    res.status(502).json({ ok: false, message });
  }
}

export function getBrandingUploadStatusHandler(_req: Request, res: Response): void {
  res.json({
    ok: true,
    uploadConfigured: isBrandingImageUploadConfigured(),
  });
}

export async function listBrandingImagesHandler(_req: Request, res: Response): Promise<void> {
  try {
    const images = await listBrandingImages();
    res.json({
      ok: true,
      uploadConfigured: isBrandingImageUploadConfigured(),
      images,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list branding images';
    res.status(500).json({ ok: false, message });
  }
}

export async function deleteBrandingImageHandler(req: Request, res: Response): Promise<void> {
  const filename = String(req.params.filename || '').trim();
  if (!filename) {
    res.status(400).json({ ok: false, message: 'filename required' });
    return;
  }
  try {
    const removed = await deleteBrandingImageFile(filename);
    if (!removed) {
      res.status(404).json({ ok: false, message: 'Image not found' });
      return;
    }
    res.json({ ok: true, filename });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    res.status(400).json({ ok: false, message });
  }
}

async function proxyOrLocalRuntimeUnavailable(req: Request, res: Response): Promise<boolean> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return true;
    }
    if (isFleetModeEnabled()) {
        res.status(400).json({
            ok: false,
            message: 'Select a VPS (fleetEdge query or X-Fleet-Edge header required)',
        });
        return true;
    }
    return false;
}

export async function getServerRuntimeHandler(req: Request, res: Response): Promise<void> {
    if (await proxyOrLocalRuntimeUnavailable(req, res)) {
        return;
    }
    try {
        const serverName = String(req.params.name || '');
        const runtime = getServerRuntime(serverName);
        res.json({ ok: true, runtime });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ ok: false, message });
    }
}

export async function startServerAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyOrLocalRuntimeUnavailable(req, res)) {
        return;
    }
    res.status(501).json({
        ok: false,
        message: 'Start server requires ac-data-edge on this VPS (use fleet edge targeting)',
    });
}

export async function stopServerAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyOrLocalRuntimeUnavailable(req, res)) {
        return;
    }
    res.status(501).json({
        ok: false,
        message: 'Stop server requires ac-data-edge on this VPS (use fleet edge targeting)',
    });
}

export async function restartServerAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyOrLocalRuntimeUnavailable(req, res)) {
        return;
    }
    res.status(501).json({
        ok: false,
        message: 'Restart server requires ac-data-edge on this VPS (use fleet edge targeting)',
    });
}

export async function provisionServerAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyOrLocalRuntimeUnavailable(req, res)) {
        return;
    }
    res.status(501).json({
        ok: false,
        message: 'Provision server requires ac-data-edge on this VPS (use fleet edge targeting)',
    });
}

export async function getServerInstanceConfigHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const serverName = String(req.params.name || '');
        const config = readServerInstanceConfig(serverName);
        let runtime;
        try {
            runtime = getServerRuntime(serverName);
        } catch {
            runtime = undefined;
        }
        res.json({
            ok: true,
            config,
            runtime,
            cmDescriptionPreview: buildCmDescription(
                normalizeBranding({
                    description: config.description,
                    webLink: config.webLink,
                    cmDescriptionBody: config.cmDescriptionBody,
                    bannerImageUrl: config.bannerImageUrl,
                    loadingImageUrl: config.loadingImageUrl,
                    loadingImageUrls: config.loadingImageUrls,
                }),
            ),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ ok: false, message });
    }
}

export async function updateServerInstanceConfigHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const serverName = String(req.params.name || '');
        const config = await updateServerInstanceConfig(serverName, req.body ?? {});
        res.json({
            ok: true,
            message: `Updated ${serverName}`,
            config,
            cmDescriptionPreview: buildCmDescription(
                normalizeBranding({
                    description: config.description,
                    webLink: config.webLink,
                    cmDescriptionBody: config.cmDescriptionBody,
                    bannerImageUrl: config.bannerImageUrl,
                    loadingImageUrl: config.loadingImageUrl,
                    loadingImageUrls: config.loadingImageUrls,
                }),
            ),
            servers: summarizeServers(),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(400).json({ ok: false, message });
    }
}

function parseBrandingUpdateBody(body: unknown): {
    brandingInput: Parameters<typeof saveAndApplyBranding>[0];
    serverNames?: string[];
} {
    const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const serverNames = Array.isArray(raw.serverNames)
        ? raw.serverNames.map((name) => String(name).trim()).filter(Boolean)
        : undefined;
    const brandingInput = { ...raw };
    delete brandingInput.serverNames;
    return {
        brandingInput: {
            ...brandingInput,
            serverNames,
        },
    };
}

export async function updateServerBrandingHandler(req: Request, res: Response): Promise<void> {
    const { brandingInput } = parseBrandingUpdateBody(req.body);

    if (
        isFleetModeEnabled() &&
        !readFleetEdgeIdFromRequest(req) &&
        isHubOwnsContent()
    ) {
        try {
            const result = await saveAndApplyBranding(brandingInput);
            const restartNote = result.cmProxiesRestarted
                ? `${result.updatedWrapper} CM wrappers restarted`
                : 'CM proxies not restarted (files updated)';
            res.json({
                ok: true,
                message: result.warning
                    ? result.warning
                    : `Branding applied to ${result.updatedIni} servers (${restartNote})`,
                branding: result.branding,
                cmDescriptionPreview: buildCmDescription(result.branding),
                updatedIni: result.updatedIni,
                updatedWrapper: result.updatedWrapper,
                cmProxiesRestarted: result.cmProxiesRestarted,
                warning: result.warning,
                servers: summarizeServers(),
            });
            return;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            res.status(500).json({ ok: false, message });
            return;
        }
    }

    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const result = await saveAndApplyBranding(brandingInput);
        const restartNote = result.cmProxiesRestarted
            ? `${result.updatedWrapper} CM wrappers restarted`
            : 'CM proxies not restarted (files updated)';
        res.json({
            ok: true,
            message: result.warning
                ? result.warning
                : `Branding applied to ${result.updatedIni} servers (${restartNote})`,
            branding: result.branding,
            cmDescriptionPreview: buildCmDescription(result.branding),
            updatedIni: result.updatedIni,
            updatedWrapper: result.updatedWrapper,
            cmProxiesRestarted: result.cmProxiesRestarted,
            warning: result.warning,
            servers: summarizeServers(),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}

export async function getHudReleasesHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    try {
        const manifest = await listHudReleases();
        res.json({ ok: true, ...manifest });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}

export async function uploadHudReleaseHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    if (!req.file) {
        res.status(400).json({ ok: false, message: 'No file uploaded' });
        return;
    }

    try {
        const result = await uploadHudRelease(req.file.path, req.file.originalname);
        if (result.ok) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}

export async function deleteHudReleaseHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const filename = String(req.params.filename || '');
    try {
        const result = await deleteHudRelease(filename);
        if (result.ok) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}

export async function downloadHudReleaseAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const filename = String(req.params.filename || '');
    const filePath = resolveHudReleasePath(filename);
    if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ ok: false, message: 'Release not found' });
        return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
}

export async function deleteEmptyContentAdminHandler(req: Request, res: Response): Promise<void> {
    if (await proxyFleetAdminIfNeeded(req, res)) {
        return;
    }
    const type = parseSyncContentType(String(req.query.type || req.body?.type || ''));
    if (!type) {
        res.status(400).json({ ok: false, message: 'Invalid type — use cars or tracks' });
        return;
    }

    const dryRun = String(req.query.dryRun ?? 'false').toLowerCase() === 'true';
    const namesRaw = req.body?.names ?? req.query.names;
    let names: string[] | undefined;
    if (Array.isArray(namesRaw)) {
        names = namesRaw.map(String);
    } else if (typeof namesRaw === 'string' && namesRaw.trim()) {
        names = namesRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }

    try {
        const result = await deleteEmptyContent(type, names, dryRun);
        res.json({ type, ...result });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ ok: false, message });
    }
}