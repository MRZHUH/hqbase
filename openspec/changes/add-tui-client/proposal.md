## Why

HQBase mail is reachable only through the React web app. Operators and developers who live in a
terminal have no way to search a shared mailbox without switching context to a browser, and the
workspace already ships an OAuth authorization server that no first-party client outside the MCP
surface can use. A terminal client that opens instantly and searches as you type closes both gaps
with the infrastructure that already exists.

## What Changes

- Add `tui/`, a new pnpm workspace package (`@hqbase/tui`) that installs the `hqbase-mail`
  command: a full-screen terminal client with type-ahead search, conversation list, thread reader,
  and message actions.
- Authenticate the client with OAuth 2.1 authorization code + PKCE against the workspace's existing
  authorization server, using dynamic client registration and a loopback redirect. No password is
  ever typed into the terminal and no long-lived shared secret is stored.
- Accept OAuth bearer tokens on the REST API. `/api/*` currently accepts only better-auth session
  cookies; a token bound to the new `<origin>/api` resource is now a first-class credential,
  scope-gated by a central allowlist so a `mail:read` token can never reach an administrative route.
- Add a **Connected apps** section to workspace settings so a user can see every application they
  have authorized, which scopes it holds, when it was last used, and revoke it.
- Cache conversation headers, snippets, and read message bodies in a local SQLite file so search is
  instant and the last synced view is readable offline. The cache is per workspace, owner-only
  (`0600`), and removable with one command.
- Extract the OAuth bearer verification that lives inside the MCP route into shared auth code used
  by both the MCP and REST surfaces, so token revocation, expiry, ban, and password-setup checks
  have exactly one implementation.

## Capabilities

### New Capabilities

- `terminal-client`: the `hqbase-mail` command — its subcommands, login flow, local cache,
  search language, key bindings, and offline behavior.
- `api-bearer-auth`: OAuth bearer authentication and scope enforcement for the REST API, including
  the `<origin>/api` protected resource and its discovery metadata.
- `connected-apps`: viewing and revoking the OAuth applications a user has authorized.

### Modified Capabilities

None. No existing capability specs are recorded in `openspec/specs/`, so all behavior introduced
here lands as new capabilities.

## Impact

- **New**: `tui/` package (zero runtime dependencies, `node:sqlite` + `node:readline`),
  `worker/auth/oauth-bearer.ts`, `worker/auth/api-scope.ts`,
  `worker/features/connected-apps/`, `app/features/settings/connected-apps-*`.
- **Modified**: `worker/auth/auth.ts` (register the API resource),
  `worker/auth/session.ts` (bearer branch), `worker/routes/index.ts` (scope middleware and the
  connected-apps route), `worker/features/mcp/route.ts` (delegate token verification),
  `app/features/settings/settings-page.tsx` and `app/lib/routes.ts` (new tab),
  `pnpm-workspace.yaml`, root `package.json`, `tsconfig.json`, `vitest.config.ts`,
  `scripts/check-architecture.mjs`.
- **Migration**: one additive `ALTER TABLE oauthAccessToken ADD COLUMN lastUsedAt TEXT` so
  Connected apps can show when a credential was last exercised. Protected resources themselves are
  declared in code; `oauthResource` and `oauthAccessToken.resources` already exist from
  `0003_oauth_resources.sql`.
- **Not breaking.** Session-cookie authentication is unchanged, and every existing route keeps its
  behavior for browser requests.
