import { apiDelete, apiGet } from "@/lib/api-client";

export type ConnectedApp = {
  clientId: string;
  name: string;
  uri: string | null;
  scopes: string[];
  resources: string[];
  grantedAt: string;
  lastUsedAt: string | null;
  activeTokenCount: number;
};

export async function listConnectedApps(): Promise<ConnectedApp[]> {
  const response = await apiGet<{ apps: ConnectedApp[] }>("/api/connected-apps");
  return response.apps;
}

export async function revokeConnectedApp(clientId: string): Promise<void> {
  await apiDelete(`/api/connected-apps/${encodeURIComponent(clientId)}`);
}
