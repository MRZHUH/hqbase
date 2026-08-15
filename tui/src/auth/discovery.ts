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
  const workspace = normalizeOrigin(origin);
  let body: {
    resource?: string;
    authorization_servers?: string[];
    scopes_supported?: string[];
  };
  try {
    body = await getJson(`${workspace}/.well-known/oauth-protected-resource/api`);
  } catch (cause) {
    // A workspace that predates terminal sign-in has no such route, so its
    // single-page app answers the request with 200 and an HTML document. That
    // is the overwhelmingly likely reason to land here, and saying so is more
    // use than reporting whatever the parser made of the markup.
    if (cause instanceof NotJsonError || cause instanceof NotFoundError) {
      throw new Error(
        `${workspace} does not offer terminal sign-in. Update the workspace to a version ` +
          "that serves /.well-known/oauth-protected-resource/api, then run login again."
      );
    }
    throw cause;
  }
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

export class NotJsonError extends Error {
  constructor(url: string) {
    super(`${url} did not answer with JSON.`);
    this.name = "NotJsonError";
  }
}

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`${url} was not found.`);
    this.name = "NotFoundError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 404) throw new NotFoundError(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}.`);

  // A single-page app happily answers any unknown path with 200 and an HTML
  // document, so a successful status is not evidence that this endpoint exists.
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    throw new NotJsonError(url);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new NotJsonError(url);
  }
}
