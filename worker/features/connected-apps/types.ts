export type ConnectedApp = {
  /** The OAuth client identifier, stable across re-authorizations. */
  clientId: string;
  name: string;
  uri: string | null;
  scopes: string[];
  /** Which protected surfaces the live credentials were issued for. */
  resources: string[];
  grantedAt: string;
  /** Null when no credential of this application has ever authenticated. */
  lastUsedAt: string | null;
  activeTokenCount: number;
};

export type ConnectedAppRow = {
  clientId: string;
  name: string | null;
  uri: string | null;
  scopes: string;
  granted_at: string;
  last_used_at: string | null;
  active_token_count: number;
  resources: string | null;
};
