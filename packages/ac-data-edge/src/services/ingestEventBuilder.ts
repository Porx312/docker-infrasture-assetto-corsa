import { buildIngestEvent as buildShared } from '@projectd/ac-data-shared/services/ingestEventBuilder.js';
import { resolveIngestServerName } from './resolveIngestServerName.js';

/** Edge ingest uses folder-slug resolution (managed servers / pool). */
export function buildIngestEvent(payload: Record<string, unknown>) {
  return buildShared(payload, resolveIngestServerName);
}
