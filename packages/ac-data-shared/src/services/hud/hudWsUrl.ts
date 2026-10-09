/** Convert an HTTP(S) edge/hub base URL to a WebSocket URL for `/hud/ws`. */

export function httpsToWss(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.toLowerCase().startsWith('https://')) {
    return `wss://${trimmed.slice(8)}`;
  }
  if (trimmed.toLowerCase().startsWith('http://')) {
    return `ws://${trimmed.slice(7)}`;
  }
  return trimmed;
}
