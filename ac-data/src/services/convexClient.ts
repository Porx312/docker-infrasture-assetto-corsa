import '../config/loadEnv.js';
import { ConvexHttpClient } from 'convex/browser';

const CONVEX_DEPLOYMENT_URL = process.env.CONVEX_DEPLOYMENT_URL || '';
const CONVEX_PRODUCT_KEY = process.env.CONVEX_PRODUCT_KEY || '';

export type ConvexClient = {
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

let cachedClient: ConvexClient | null = null;

export function ensureConvexClient(): ConvexClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_PRODUCT_KEY) {
    throw new Error('CONVEX_DEPLOYMENT_URL / CONVEX_PRODUCT_KEY must be set');
  }

  const client = new ConvexHttpClient(CONVEX_DEPLOYMENT_URL);
  const anyClient = client as unknown as {
    setAdminAuth: (token: string) => void;
    mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
  anyClient.setAdminAuth(CONVEX_PRODUCT_KEY);

  cachedClient = {
    mutation: anyClient.mutation.bind(anyClient),
    query: anyClient.query.bind(anyClient),
  };

  return cachedClient;
}

export function isConvexConfigured(): boolean {
  return Boolean(CONVEX_DEPLOYMENT_URL && CONVEX_PRODUCT_KEY);
}

/** Test helper: reset singleton between tests. */
export function resetConvexClientForTests(): void {
  cachedClient = null;
}
