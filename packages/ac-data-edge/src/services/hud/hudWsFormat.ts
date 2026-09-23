export function formatWsMessage(event: string, data: unknown): string {
  return JSON.stringify({ event, data });
}

export function writeWsEvent(
  send: (payload: string) => void,
  event: string,
  data: unknown,
): void {
  send(formatWsMessage(event, data));
}
