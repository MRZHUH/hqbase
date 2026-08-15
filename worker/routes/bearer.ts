import type { Context, MiddlewareHandler } from "hono";

import { apiScopeFor } from "../auth/api-scope";
import { apiResource, authIssuer, authOrigin } from "../auth/auth";
import { bearerToken, loadBearerToken, touchOAuthToken } from "../auth/oauth-bearer";
import type { HonoApp, WorkerEnv } from "../lib/env";
import { errorBody } from "../lib/errors";

export const apiResourceMetadataPath = "/.well-known/oauth-protected-resource/api";

const bearerScopes = ["mail:read", "mail:write", "mail:send"] as const;

/**
 * Gates every access-token request before any route runs.
 *
 * Requests without a bearer token pass straight through, so browser sessions are
 * untouched. Requests with one must name a route on the allowlist and hold the
 * scope that route costs; everything else is refused here rather than inside a
 * handler that might forget to ask.
 */
export function enforceBearerScope(): MiddlewareHandler<HonoApp> {
  return async (c, next) => {
    if (!bearerToken(c.req.raw)) return next();

    const scope = apiScopeFor(c.req.method, new URL(c.req.raw.url).pathname);
    if (!scope) {
      return c.json(
        errorBody(
          "BEARER_NOT_ALLOWED",
          "This route is not available to application credentials. Sign in to use it."
        ),
        403
      );
    }

    const token = await loadBearerToken(c.env, c.req.raw);
    if (!token || !isApiToken(c.env, c.req.raw, token.resources)) {
      return unauthenticated(c);
    }
    if (!token.scopes.has(scope)) {
      return c.json(
        errorBody("INSUFFICIENT_SCOPE", `This action requires the "${scope}" scope.`),
        403
      );
    }

    // Recording use must never decide whether the request succeeds.
    c.executionCtx.waitUntil(touchOAuthToken(c.env, token).catch(() => undefined));
    return next();
  };
}

/**
 * Metadata that tells a client which authorization server issues tokens for this
 * API and which scopes it honours, per RFC 9728.
 */
export function apiResourceMetadata(env: WorkerEnv, request: Request): Response {
  return Response.json(
    {
      resource: apiResource(env, request),
      authorization_servers: [authIssuer(env, request)],
      scopes_supported: bearerScopes,
      bearer_methods_supported: ["header"]
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300"
      }
    }
  );
}

function unauthenticated(c: Context<HonoApp>): Response {
  return c.json(errorBody("UNAUTHENTICATED", "Sign in is required."), 401, {
    "www-authenticate": bearerChallenge(c.env, c.req.raw)
  });
}

function bearerChallenge(env: WorkerEnv, request: Request): string {
  const metadata = `${authOrigin(env, request)}${apiResourceMetadataPath}`;
  return `Bearer resource_metadata="${metadata}", scope="${bearerScopes.join(" ")}"`;
}

function isApiToken(env: WorkerEnv, request: Request, resources: readonly string[]): boolean {
  return resources.length === 1 && resources[0] === apiResource(env, request);
}
