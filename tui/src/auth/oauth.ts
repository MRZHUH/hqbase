import { normalizeOrigin } from "../config/paths.js";
import type { Credentials } from "../config/store.js";

import { discoverApiResource, discoverAuthorizationServer } from "./discovery.js";
import { listenForRedirect } from "./loopback.js";
import { createPkce, createState } from "./pkce.js";

export const clientName = "HQBase Terminal";

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type LoginOptions = {
  origin: string;
  write: boolean;
  /** Called with the URL to visit; the caller decides how to surface it. */
  onAuthorizationUrl: (url: string) => void;
  timeoutMs?: number;
};

export function requestedScopes(write: boolean): string[] {
  // Read-only unless the operator explicitly asks otherwise, so the credential
  // sitting on a laptop cannot change mail state by default.
  return write ? ["mail:read", "mail:write", "offline_access"] : ["mail:read", "offline_access"];
}

export async function login(options: LoginOptions): Promise<Credentials> {
  const origin = normalizeOrigin(options.origin);
  const resource = await discoverApiResource(origin);
  const issuer = resource.authorizationServers[0];
  if (!issuer) throw new Error("This workspace advertises no authorization server.");
  const server = await discoverAuthorizationServer(issuer);
  if (!server.registrationEndpoint) {
    throw new Error("This workspace does not accept client registration.");
  }

  const scopes = requestedScopes(options.write);
  const state = createState();
  const pkce = createPkce();
  const listener = await listenForRedirect({
    state,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });

  try {
    const client = await register(server.registrationEndpoint, listener.redirectUri, scopes);
    const authorizationUrl = buildAuthorizationUrl({
      endpoint: server.authorizationEndpoint,
      clientId: client.clientId,
      redirectUri: listener.redirectUri,
      resource: resource.resource,
      scopes,
      state,
      challenge: pkce.challenge
    });
    options.onAuthorizationUrl(authorizationUrl);

    const redirect = await listener.waitForRedirect();
    const token = await exchange(server.tokenEndpoint, {
      grant_type: "authorization_code",
      code: redirect.code,
      redirect_uri: listener.redirectUri,
      client_id: client.clientId,
      code_verifier: pkce.verifier,
      resource: resource.resource,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {})
    });

    return toCredentials(origin, client.clientId, client.clientSecret, token, scopes);
  } finally {
    listener.close();
  }
}

export async function refreshAccessToken(credentials: Credentials): Promise<Credentials> {
  if (!credentials.refreshToken) {
    throw new Error("This workspace connection cannot be refreshed. Run login again.");
  }
  const resource = await discoverApiResource(credentials.origin);
  const issuer = resource.authorizationServers[0];
  if (!issuer) throw new Error("This workspace advertises no authorization server.");
  const server = await discoverAuthorizationServer(issuer);

  const token = await exchange(server.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    resource: resource.resource,
    ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {})
  });

  return toCredentials(
    credentials.origin,
    credentials.clientId,
    credentials.clientSecret,
    token,
    credentials.scopes,
    credentials.refreshToken
  );
}

/** Best-effort revocation: logout must succeed even with the workspace down. */
export async function revoke(credentials: Credentials): Promise<boolean> {
  try {
    const resource = await discoverApiResource(credentials.origin);
    const issuer = resource.authorizationServers[0];
    if (!issuer) return false;
    const server = await discoverAuthorizationServer(issuer);
    if (!server.revocationEndpoint) return false;
    const response = await fetch(server.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: credentials.refreshToken ?? credentials.accessToken,
        token_type_hint: credentials.refreshToken ? "refresh_token" : "access_token",
        client_id: credentials.clientId,
        ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {})
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function buildAuthorizationUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  state: string;
  challenge: string;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Names the surface the token is for, so the workspace binds it to the API
  // rather than to one of the MCP profiles.
  url.searchParams.set("resource", input.resource);
  return url.toString();
}

async function register(
  endpoint: string,
  redirectUri: string,
  scopes: string[]
): Promise<{ clientId: string; clientSecret: string | null }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopes.join(" ")
    })
  });
  if (!response.ok) {
    throw new Error(`This workspace refused client registration (${response.status}).`);
  }
  const body = (await response.json()) as { client_id?: string; client_secret?: string };
  if (!body.client_id) throw new Error("The workspace registered no client identifier.");
  return { clientId: body.client_id, clientSecret: body.client_secret ?? null };
}

async function exchange(endpoint: string, form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form)
  });
  if (!response.ok) {
    // The body can echo the code or the refresh token, so only the status is
    // ever surfaced.
    throw new Error(`The workspace refused the token request (${response.status}).`);
  }
  return (await response.json()) as TokenResponse;
}

function toCredentials(
  origin: string,
  clientId: string,
  clientSecret: string | null,
  token: TokenResponse,
  requested: string[],
  previousRefresh: string | null = null
): Credentials {
  if (!token.access_token) throw new Error("The workspace issued no access token.");
  return {
    origin,
    clientId,
    clientSecret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scopes: token.scope ? token.scope.split(" ").filter(Boolean) : requested
  };
}
