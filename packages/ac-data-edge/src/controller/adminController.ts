/**
 * Edge-local admin handlers: AC lifecycle, runtime, branding, instance config.
 * Content/HUD disk handlers live in @projectd/ac-data-shared.
 */
import type { Request, Response } from 'express';
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
import { getServerRuntime, serverBinaryExists } from '../services/serverRuntime.js';
import {
  restartServerCore,
  startServerCore,
  stopServerCore,
} from './controller.js';
import { provisionServerInstance } from '../services/serverProvision.js';

export {
  getContent,
  getContentItems,
  getContentPreview,
  deleteContentItem,
  uploadContent,
  uploadMultipleContent,
  getHudReleasesHandler,
  uploadHudReleaseHandler,
  deleteHudReleaseHandler,
  downloadHudReleaseAdminHandler,
  deleteEmptyContentAdminHandler,
} from '@projectd/ac-data-shared/controller/adminContentHandlers.js';

export async function getServerBrandingHandler(_req: Request, res: Response): Promise<void> {
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

export async function getServerRuntimeHandler(req: Request, res: Response): Promise<void> {
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
  try {
    const serverName = String(req.params.name || '');
    if (!serverBinaryExists(serverName)) {
      res.status(400).json({ ok: false, message: `Server binary not found: ${serverName}` });
      return;
    }
    const { assertModsReadyForServerStart } = await import('../services/modAgent/startGate.js');
    const modGate = await assertModsReadyForServerStart(serverName);
    if (!modGate.ok) {
      res.status(409).json({
        ok: false,
        code: modGate.code,
        missing: modGate.items,
        message: 'Required mods are not READY on this VPS',
      });
      return;
    }
    const result = startServerCore(serverName);
    const runtime = getServerRuntime(serverName);
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      message: result.message,
      running: runtime.running,
      pid: runtime.pid,
      runtime,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ ok: false, message });
  }
}

export async function stopServerAdminHandler(req: Request, res: Response): Promise<void> {
  try {
    const serverName = String(req.params.name || '');
    const result = await stopServerCore(serverName);
    const runtime = getServerRuntime(serverName);
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      message: result.message,
      running: runtime.running,
      pid: runtime.pid,
      runtime,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ ok: false, message });
  }
}

export async function restartServerAdminHandler(req: Request, res: Response): Promise<void> {
  try {
    const serverName = String(req.params.name || '');
    const result = await restartServerCore(serverName);
    const runtime = getServerRuntime(serverName);
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      message: result.message,
      running: runtime.running,
      pid: runtime.pid,
      runtime,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ ok: false, message });
  }
}

export async function provisionServerAdminHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const displayName =
      typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
    const start = body.start === true;
    const result = await provisionServerInstance({ displayName, start });
    res.json({
      ok: true,
      message: result.message,
      server: result.server,
      runtime: result.runtime,
      servers: summarizeServers(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ ok: false, message });
  }
}

export async function getServerInstanceConfigHandler(req: Request, res: Response): Promise<void> {
  try {
    const serverName = String(req.params.name || '');
    const config = readServerInstanceConfig(serverName);
    const runtime = getServerRuntime(serverName);
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

export async function updateServerBrandingHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await saveAndApplyBranding(req.body ?? {});
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
