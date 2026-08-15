import type { WorkerEnv } from "../lib/env";
import type { WorkspaceRole } from "../lib/validation";
import { workspaceRoleSchema } from "../lib/validation";

import { hashOAuthToken } from "./oauth-token";
import { isPasswordSetupRequired } from "./password-setup";

export const oauthTokenPrefix = "hqb_access_";

// Both protected surfaces resolve the same token on the same request: the API
// scope middleware runs before the route handler that later asks for the auth
// context. Memoizing on the Request keeps that to one D1 read.
const resolvedTokens = new WeakMap<Request, Promise<BearerToken | null>>();

export type BearerToken = {
  id: string;
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  role: WorkspaceRole;
  /** Scopes the token carries, already narrowed to what the user consented to. */
  scopes: ReadonlySet<string>;
  /** Resource identifiers the token was issued for. */
  resources: readonly string[];
  issuedAt: string;
  lastUsedAt: string | null;
};

export type OAuthPrincipal = {
  tokenId: string;
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  role: WorkspaceRole;
  scopes: ReadonlySet<string>;
  issuedAt: string;
};

type TokenRow = {
  id: string;
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  scopes: string;
  resources: string | null;
  consentScopes: string;
  tokenExpiresAt: string;
  sessionExpiresAt: string;
  lastUsedAt: string | null;
  revoked: string | null;
  clientDisabled: number | null;
  role: string | null;
  banned: number | null;
  banExpires: string | null;
};

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const value = authorization.slice("Bearer ".length).trim();
  if (!value.startsWith(oauthTokenPrefix)) return null;
  const secret = value.slice(oauthTokenPrefix.length);
  return secret === "" ? null : secret;
}

/**
 * Resolves and fully validates the request's bearer token without deciding what
 * it may reach. Returns null for every failure — absent, malformed, unknown,
 * revoked, expired, disabled client, banned user, or an account that still owes
 * a password replacement — so no caller can distinguish them and probe for
 * valid token values.
 */
export async function loadBearerToken(
  env: WorkerEnv,
  request: Request
): Promise<BearerToken | null> {
  const cached = resolvedTokens.get(request);
  if (cached) return cached;
  const pending = readBearerToken(env, request);
  resolvedTokens.set(request, pending);
  return pending;
}

/**
 * Resolves the request's token for one protected resource. `allowedScopes`
 * bounds what the surface can ever grant, so a token minted for a wider profile
 * cannot carry extra authority onto a narrower one.
 */
export async function verifyOAuthBearer(
  env: WorkerEnv,
  request: Request,
  options: { resource: string; allowedScopes: readonly string[] }
): Promise<OAuthPrincipal | null> {
  const token = await loadBearerToken(env, request);
  if (!token) return null;
  // A token names exactly one resource. Accepting a token issued for another
  // surface would silently widen every integration already deployed against it.
  if (token.resources.length !== 1 || token.resources[0] !== options.resource) return null;
  const allowed = new Set(options.allowedScopes);
  return {
    tokenId: token.id,
    userId: token.userId,
    email: token.email,
    name: token.name,
    sessionId: token.sessionId,
    role: token.role,
    scopes: new Set([...token.scopes].filter((scope) => allowed.has(scope))),
    issuedAt: token.issuedAt
  };
}

/**
 * Records that a token authenticated a request. Writing on every request would
 * add a D1 write to every API call for a value nobody reads at that precision,
 * so this is a no-op unless the stored timestamp is absent or older than the
 * throttle window.
 */
export async function touchOAuthToken(
  env: WorkerEnv,
  token: Pick<BearerToken, "id" | "lastUsedAt">,
  now = new Date(),
  throttleMs = 5 * 60 * 1000
): Promise<void> {
  const previous = token.lastUsedAt ? Date.parse(token.lastUsedAt) : Number.NaN;
  if (Number.isFinite(previous) && now.getTime() - previous < throttleMs) return;
  await env.DB.prepare(`UPDATE oauthAccessToken SET lastUsedAt = ? WHERE id = ?`)
    .bind(now.toISOString(), token.id)
    .run();
}

export function parseStoredList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Older adapters may persist a space-delimited scope value.
  }
  return value.split(" ").filter(Boolean);
}

async function readBearerToken(env: WorkerEnv, request: Request): Promise<BearerToken | null> {
  const secret = bearerToken(request);
  if (!secret) return null;

  const row = await env.DB.prepare(
    `SELECT at.id, at.userId, at.sessionId, at.scopes, at.resources,
            at.expiresAt AS tokenExpiresAt, at.createdAt AS issuedAt,
            at.lastUsedAt, at.revoked,
            c.disabled AS clientDisabled, oc.scopes AS consentScopes,
            u.email, u.name, u.role, u.banned, u.banExpires,
            s.expiresAt AS sessionExpiresAt
     FROM oauthAccessToken at
     JOIN oauthClient c ON c.clientId = at.clientId
     JOIN oauthConsent oc ON oc.clientId = at.clientId AND oc.userId = at.userId
     JOIN "user" u ON u.id = at.userId
     JOIN "session" s ON s.id = at.sessionId AND s.userId = at.userId
     WHERE at.token = ?`
  )
    .bind(await hashOAuthToken(secret))
    .first<TokenRow & { issuedAt: string }>();

  const now = new Date();
  if (
    !row ||
    row.revoked !== null ||
    row.clientDisabled === 1 ||
    new Date(row.tokenExpiresAt) <= now ||
    new Date(row.sessionExpiresAt) <= now
  ) {
    return null;
  }
  if (row.banned === 1 && (!row.banExpires || new Date(row.banExpires) > now)) return null;

  const role = workspaceRoleSchema.safeParse(row.role ?? "member");
  if (!role.success) return null;
  if (await isPasswordSetupRequired(env.DB, row.userId)) return null;

  const consented = new Set(parseStoredList(row.consentScopes));
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    name: row.name,
    sessionId: row.sessionId,
    role: role.data,
    scopes: new Set(parseStoredList(row.scopes).filter((scope) => consented.has(scope))),
    resources: parseStoredList(row.resources),
    issuedAt: row.issuedAt,
    lastUsedAt: row.lastUsedAt
  };
}
