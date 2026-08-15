/**
 * The routes an OAuth access token may reach on the REST API, and the scope each
 * one costs.
 *
 * This table is deny-by-default and it is the only thing standing between a
 * `mail:read` token and every administrative route in the workspace. A route
 * that is not listed here refuses bearer credentials outright, whatever the
 * token's scopes and whatever the token owner's workspace role. Adding an entry
 * is therefore a deliberate, reviewable act: nothing becomes reachable by
 * accident when a new route file is registered.
 *
 * Credential management is deliberately absent. A token can never mint, inspect,
 * or revoke another credential, so a leaked token cannot extend its own life.
 */

export const apiScopes = ["mail:read", "mail:write", "mail:send"] as const;
export type ApiScope = (typeof apiScopes)[number];

type Entry = {
  method: string;
  /** Path with `:name` standing for exactly one segment. No wildcards. */
  pattern: string;
  scope: ApiScope;
};

const allowlist: readonly Entry[] = [
  { method: "GET", pattern: "/api/me", scope: "mail:read" },
  { method: "GET", pattern: "/api/mailboxes", scope: "mail:read" },
  { method: "GET", pattern: "/api/conversations", scope: "mail:read" },
  { method: "GET", pattern: "/api/messages", scope: "mail:read" },
  { method: "GET", pattern: "/api/messages/:id", scope: "mail:read" },
  { method: "GET", pattern: "/api/messages/:id/thread", scope: "mail:read" },
  { method: "GET", pattern: "/api/attachments/:id", scope: "mail:read" },

  { method: "POST", pattern: "/api/conversations/:id/read", scope: "mail:write" },
  { method: "POST", pattern: "/api/conversations/:id/unread", scope: "mail:write" },
  { method: "POST", pattern: "/api/conversations/:id/star", scope: "mail:write" },
  { method: "POST", pattern: "/api/conversations/:id/unstar", scope: "mail:write" },
  { method: "POST", pattern: "/api/conversations/:id/archive", scope: "mail:write" },
  { method: "POST", pattern: "/api/conversations/:id/trash", scope: "mail:write" },

  { method: "POST", pattern: "/api/messages/:id/read", scope: "mail:write" },
  { method: "POST", pattern: "/api/messages/:id/unread", scope: "mail:write" },
  { method: "POST", pattern: "/api/messages/:id/star", scope: "mail:write" },
  { method: "POST", pattern: "/api/messages/:id/unstar", scope: "mail:write" },
  { method: "POST", pattern: "/api/messages/:id/archive", scope: "mail:write" },
  { method: "POST", pattern: "/api/messages/:id/trash", scope: "mail:write" }
];

/**
 * The scope a bearer request needs, or null when tokens may not reach the route
 * at all. Matching is literal, segment by segment: a pattern can never cover
 * more paths than it reads as.
 */
export function apiScopeFor(method: string, pathname: string): ApiScope | null {
  const requested = segments(pathname);
  if (!requested) return null;
  const upper = method.toUpperCase();
  for (const entry of allowlist) {
    if (entry.method !== upper) continue;
    if (matches(entry.pattern, requested)) return entry.scope;
  }
  return null;
}

/** Every route reachable with a token, for the protected-resource metadata. */
export function bearerAllowlist(): ReadonlyArray<{
  method: string;
  path: string;
  scope: ApiScope;
}> {
  return allowlist.map((entry) => ({
    method: entry.method,
    path: entry.pattern,
    scope: entry.scope
  }));
}

function matches(pattern: string, requested: readonly string[]): boolean {
  const expected = pattern.split("/").filter((segment) => segment !== "");
  if (expected.length !== requested.length) return false;
  return expected.every((segment, index) => {
    const actual = requested[index];
    if (actual === undefined) return false;
    // A parameter stands for one non-empty segment and nothing else, so an id
    // can never absorb a path separator or an emptied segment.
    return segment.startsWith(":") ? actual !== "" : segment === actual;
  });
}

function segments(pathname: string): string[] | null {
  const parts = pathname.split("/");
  const kept: string[] = [];
  for (const [index, part] of parts.entries()) {
    // A trailing slash is the one empty segment a path may legitimately end on;
    // anywhere else an empty or relative segment means the path was not
    // normalized and is not safe to match literally.
    if (part === "") {
      if (index === 0 || index === parts.length - 1) continue;
      return null;
    }
    if (part === "." || part === "..") return null;
    kept.push(part);
  }
  return kept;
}
