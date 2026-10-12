import '../config/loadEnv.js';
import { ConvexHttpClient } from 'convex/browser';

export type ConvexClient = {
  mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

let cachedClient: ConvexClient | null = null;

function convexDeploymentUrl(): string {
  return (process.env.CONVEX_DEPLOYMENT_URL || '').trim();
}

function convexProductKey(): string {
  return (process.env.CONVEX_PRODUCT_KEY || '').trim();
}

export function ensureConvexClient(): ConvexClient {
  if (cachedClient) {
    return cachedClient;
  }

  const deploymentUrl = convexDeploymentUrl();
  const productKey = convexProductKey();
  if (!deploymentUrl || !productKey) {
    throw new Error('CONVEX_DEPLOYMENT_URL / CONVEX_PRODUCT_KEY must be set');
  }

  const client = new ConvexHttpClient(deploymentUrl);
  const anyClient = client as unknown as {
    setAdminAuth: (token: string) => void;
    mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    query: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
  anyClient.setAdminAuth(productKey);

  cachedClient = {
    mutation: anyClient.mutation.bind(anyClient),
    query: anyClient.query.bind(anyClient),
  };

  return cachedClient;
}

export function isConvexConfigured(): boolean {
  return Boolean(convexDeploymentUrl() && convexProductKey());
}

/** Test helper: reset singleton between tests. */
export function resetConvexClientForTests(): void {
  cachedClient = null;
}

/** Test helper: inject a mock Convex client. */
export function setConvexClientForTests(client: ConvexClient | null): void {
  cachedClient = client;
}
