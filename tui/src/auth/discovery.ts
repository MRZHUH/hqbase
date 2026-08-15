import { normalizeOrigin } from "../config/paths.js";

export type AuthorizationServer = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  revocationEndpoint: string | null;
};

export type ProtectedResource = {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
};

/**
 * Reads the workspace's own advertisement of where to authorize and which scopes
 * its API accepts, so nothing about the flow is hard-coded to one deployment.
 */
export async function discoverApiResource(origin: string): Promise<ProtectedResource> {
  const body = await getJson<{
    resource?: string;
    authorization_servers?: string[];
    scopes_supported?: string[];
  }>(`${normalizeOrigin(origin)}/.well-known/oauth-protected-resource/api`);
  if (!body.resource || !body.authorization_servers?.length) {
    throw new Error("This workspace does not advertise an API resource to authorize against.");
  }
  return {
    resource: body.resource,
    authorizationServers: body.authorization_servers,
    scopesSupported: body.scopes_supported ?? []
  };
}

export async function discoverAuthorizationServer(issuer: string): Promise<AuthorizationServer> {
  const url = new URL(issuer);
  // RFC 8414 places the document at the issuer's path suffixed onto the
  // well-known prefix, which is where this workspace serves it.
  const metadataUrl = `${url.origin}/.well-known/oauth-authorization-server${url.pathname.replace(/\/$/, "")}`;
  const body = await getJson<{
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
    revocation_endpoint?: string;
  }>(metadataUrl);
  if (!body.authorization_endpoint || !body.token_endpoint) {
    throw new Error("The workspace authorization server did not advertise its endpoints.");
  }
  return {
    issuer: body.issuer ?? issuer,
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
    registrationEndpoint: body.registration_endpoint ?? null,
    revocationEndpoint: body.revocation_endpoint ?? null
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}.`);
  }
  return (await response.json()) as T;
}
