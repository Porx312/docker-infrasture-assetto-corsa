import fs from 'node:fs';
import type { Request, Response } from 'express';

type MulterFile = NonNullable<Request['file']>;
import { resolveFleetEdge } from '@projectd/ac-data-shared/services/fleet/fleetRegistry.js';
import { fleetEdgeSecret } from '@projectd/ac-data-shared/services/secrets/fleetSecrets.js';

const PROXY_TIMEOUT_MS = Number(process.env.FLEET_ADMIN_PROXY_TIMEOUT_MS || 120_000);

function workerSecret(): string {
  return fleetEdgeSecret();
}

function buildTargetUrl(baseUrl: string, originalUrl: string): URL {
  const url = new URL(originalUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.delete('fleetEdge');
  return url;
}

function headersForProxy(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Worker-Secret': workerSecret(),
  };
  const accept = req.headers.accept;
  if (typeof accept === 'string' && accept.trim()) {
    headers.Accept = accept;
  }
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string' && contentType.trim()) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

async function buildBody(req: Request): Promise<RequestInit['body']> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined;
  }

  const file = req.file as MulterFile | undefined;
  const files = req.files as MulterFile[] | undefined;

  if (file || (files && files.length > 0)) {
    const form = new FormData();
    const appendFile = (f: MulterFile) => {
      const buffer = fs.readFileSync(f.path);
      const blob = new Blob([buffer], { type: f.mimetype || 'application/octet-stream' });
      form.append(f.fieldname || 'file', blob, f.originalname);
    };
    if (file) {
      appendFile(file);
    }
    if (files) {
      for (const f of files) {
        appendFile(f);
      }
    }
    return form;
  }

  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return JSON.stringify(req.body);
  }
  return undefined;
}

export async function proxyAdminRequestToEdge(
  edgeId: string,
  req: Request,
  res: Response,
): Promise<void> {
  const edge = resolveFleetEdge(edgeId);
  if (!edge) {
    res.status(404).json({ ok: false, message: 'Unknown fleet edge', fleetEdge: edgeId });
    return;
  }
  const secret = workerSecret();
  if (!secret) {
    res.status(503).json({
      ok: false,
      message: 'FLEET_EDGE_SECRET or CONVEX_WORKER_SECRET not configured on hub',
    });
    return;
  }

  const targetUrl = buildTargetUrl(edge.baseUrl, req.originalUrl);
  const method = req.method.toUpperCase();

  try {
    const headers = headersForProxy(req);
    const body = await buildBody(req);
    if (body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });

    const contentType = upstream.headers.get('content-type') || '';
    res.status(upstream.status);

    const disposition = upstream.headers.get('content-disposition');
    if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    }
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }

    if (contentType.includes('application/json')) {
      const json: unknown = await upstream.json();
      res.json(json);
      return;
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(
      `[admin-fleet-proxy] ${method} ${targetUrl.pathname} edge=${edgeId} failed: ${message}`,
    );
    res.status(502).json({
      ok: false,
      reason: 'edge_unreachable',
      fleetEdge: edgeId,
      message,
    });
  }
}
