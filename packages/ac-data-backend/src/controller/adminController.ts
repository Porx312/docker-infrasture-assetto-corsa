/**
 * Hub admin handlers: fleet proxy wrappers + hub-local branding images.
 * Content/HUD disk + auth handlers live in @projectd/ac-data-shared.
 */
import type { Request, Response } from 'express';
import fs from 'fs';
import {
  getContent as localGetContent,
  getContentItems as localGetContentItems,
  getContentPreview as localGetContentPreview,
  deleteContentItem as localDeleteContentItem,
  uploadContent as localUploadContent,
  uploadMultipleContent as localUploadMultipleContent,
  getHudReleasesHandler as localGetHudReleasesHandler,
  uploadHudReleaseHandler as localUploadHudReleaseHandler,
  deleteHudReleaseHandler as localDeleteHudReleaseHandler,
  downloadHudReleaseAdminHandler as localDownloadHudReleaseAdminHandler,
  deleteEmptyContentAdminHandler as localDeleteEmptyContentAdminHandler,
} from '@projectd/ac-data-shared/controller/adminContentHandlers.js';
import {
  buildCmDescription,
  normalizeBranding,
  readServerBranding,
  saveAndApplyBranding,
  summarizeServers,
} from '@projectd/ac-data-shared/services/serverBranding.js';
import {
  readServerInstanceConfig,
  updateServerInstanceConfig,
} from '@projectd/ac-data-shared/services/serverInstanceConfig.js';
import { getServerRuntime } from '../services/serverRuntime.js';
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

export {
  adminLogin,
  adminLogout,
  adminCheck,
} from '@projectd/ac-data-shared/controller/adminAuthHandlers.js';

export async function getContent(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localGetContent(req, res);
}

export async function getContentItems(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localGetContentItems(req, res);
}

export async function getContentPreview(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localGetContentPreview(req, res);
}

export async function deleteContentItem(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localDeleteContentItem(req, res);
}

export async function uploadContent(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localUploadContent(req, res);
}

export async function uploadMultipleContent(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localUploadMultipleContent(req, res);
}

export async function getServerBrandingHandler(req: Request, res: Response): Promise<void> {
  if (isFleetModeEnabled() && !readFleetEdgeIdFromRequest(req) && isHubOwnsContent()) {
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
  if (await proxyFleetAdminIfNeeded(req, res)) return;
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
  if (await proxyOrLocalRuntimeUnavailable(req, res)) return;
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
  if (await proxyOrLocalRuntimeUnavailable(req, res)) return;
  res.status(501).json({
    ok: false,
    message: 'Start server requires ac-data-edge on this VPS (use fleet edge targeting)',
  });
}

export async function stopServerAdminHandler(req: Request, res: Response): Promise<void> {
  if (await proxyOrLocalRuntimeUnavailable(req, res)) return;
  res.status(501).json({
    ok: false,
    message: 'Stop server requires ac-data-edge on this VPS (use fleet edge targeting)',
  });
}

export async function restartServerAdminHandler(req: Request, res: Response): Promise<void> {
  if (await proxyOrLocalRuntimeUnavailable(req, res)) return;
  res.status(501).json({
    ok: false,
    message: 'Restart server requires ac-data-edge on this VPS (use fleet edge targeting)',
  });
}

export async function provisionServerAdminHandler(req: Request, res: Response): Promise<void> {
  if (await proxyOrLocalRuntimeUnavailable(req, res)) return;
  res.status(501).json({
    ok: false,
    message: 'Provision server requires ac-data-edge on this VPS (use fleet edge targeting)',
  });
}

export async function getServerInstanceConfigHandler(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
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
  if (await proxyFleetAdminIfNeeded(req, res)) return;
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

  if (isFleetModeEnabled() && !readFleetEdgeIdFromRequest(req) && isHubOwnsContent()) {
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

  if (await proxyFleetAdminIfNeeded(req, res)) return;
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
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localGetHudReleasesHandler(req, res);
}

export async function uploadHudReleaseHandler(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localUploadHudReleaseHandler(req, res);
}

export async function deleteHudReleaseHandler(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localDeleteHudReleaseHandler(req, res);
}

export async function downloadHudReleaseAdminHandler(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localDownloadHudReleaseAdminHandler(req, res);
}

export async function deleteEmptyContentAdminHandler(req: Request, res: Response): Promise<void> {
  if (await proxyFleetAdminIfNeeded(req, res)) return;
  await localDeleteEmptyContentAdminHandler(req, res);
}
