import { Router, type Request, type Response } from 'express';

import { submitPayloadsToConvexIngest } from '@projectd/ac-data-shared/services/convexIngestBatch.js';
import {
  isWorkerRequestAuthorized,
  readInstanceIdFromWorkerRequest,
} from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';

const router = Router();

function normalizeHttpIngestPayload(
  row: unknown,
  fallbackInstanceId: string,
): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const record = row as Record<string, unknown>;
  if (typeof record.event === 'string' && record.event.trim()) {
    const next = { ...record };
    if (!next.instanceId && fallbackInstanceId) {
      next.instanceId = fallbackInstanceId;
    }
    return next;
  }
  if (typeof record.eventType === 'string' && record.eventType.trim()) {
    const data =
      record.data && typeof record.data === 'object'
        ? (record.data as Record<string, unknown>)
        : {};
    const meta =
      data._meta && typeof data._meta === 'object'
        ? (data._meta as Record<string, unknown>)
        : {};
    const instanceId =
      (typeof meta.instanceId === 'string' && meta.instanceId.trim()) || fallbackInstanceId;
    return {
      event: record.eventType,
      serverName: record.serverName,
      data,
      instanceId,
      eventId: meta.eventId,
      schemaVersion: meta.schemaVersion,
      ts: meta.ts,
    };
  }
  return null;
}

router.post('/ingest-events', (req: Request, res: Response) => {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const instanceId = readInstanceIdFromWorkerRequest(req);
  const body = req.body as { events?: unknown } | undefined;
  const rawEvents = Array.isArray(body?.events) ? body.events : [];
  if (rawEvents.length === 0) {
    res.status(400).json({ ok: false, error: 'events array required' });
    return;
  }

  const payloads: Record<string, unknown>[] = [];
  for (const row of rawEvents) {
    const normalized = normalizeHttpIngestPayload(row, instanceId);
    if (normalized) {
      payloads.push(normalized);
    }
  }
  if (payloads.length === 0) {
    res.status(400).json({ ok: false, error: 'no_valid_events' });
    return;
  }

  console.log(
    `[worker-ingest] instanceId=${instanceId || '?'} events=${payloads.length}`,
  );

  void submitPayloadsToConvexIngest(payloads)
    .then((ingestResult) => {
      const failed = ingestResult.failed ?? 0;
      if (ingestResult.ok === false || failed > 0) {
        res.status(503).json({ ok: false, ingestResult });
        return;
      }
      res.json({ ok: true, ingestResult, forwardCount: payloads.length });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[worker-ingest] failed:', message);
      res.status(503).json({ ok: false, error: message });
    });
});

export default router;
