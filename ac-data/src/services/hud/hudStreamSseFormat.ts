import type { Response } from 'express';

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(formatSseEvent(event, data));
}
