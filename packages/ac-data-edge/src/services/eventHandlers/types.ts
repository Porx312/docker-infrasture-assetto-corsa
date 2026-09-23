export type EventPayload = Record<string, unknown>;

export type StreamAckMessage = {
  id: string;
  fields?: Record<string, string>;
  message?: Record<string, string>;
};
