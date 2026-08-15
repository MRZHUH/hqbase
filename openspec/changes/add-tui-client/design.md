## Context

See `proposal.md` — Why. The constraints that shape this design:

- `/api/*` authenticates only through `getAuthContext()`, which delegates to better-auth's
  `getSession()` and therefore only understands session cookies.
- A complete opaque-token verifier already exists, but it is private to
  `worker/features/mcp/route.ts::authenticateMcp` and hard-binds every token to an MCP resource.
- The authorization server is already configured with dynamic, unauthenticated client registration
  and a consent page, so a terminal client needs no pre-provisioning.
- `listConversationPage` supports `search`, `folder`, `mailboxId`, and a cursor, which is exactly the
  shape a client needs to page a cache forward.
- The repo is a single pnpm package with a strict gate: Biome, `tsc --noEmit` under
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, Vitest unit + Workers integration,
  coverage thresholds, and an architecture check capping files at 400 lines.
- Node 26 is the toolchain, so `node:sqlite` and `node:readline` are available without a native
  build step.

## Goals / Non-Goals

**Goals:**

- One token verifier serving both the MCP and REST surfaces.
- A bearer surface that is deny-by-default: adding a route never silently exposes it to tokens.
- A terminal client with zero runtime dependencies, so `pnpm check` gains no new supply chain.
- A client whose search feels local because it is local, with server search as an explicit action.
- Pure, testable state transitions in the client: no test may need a real TTY.

**Non-Goals:**

- Composing, replying, forwarding, or sending from the terminal. The client is read-and-triage;
  `mail:send` is not requested by the login flow.
- HTML rendering, MIME viewing, or attachment download in the terminal.
- Any change to how browsers authenticate.
- Full mailbox replication. The cache is a bounded window, not a mail store.

## Decisions

### Bearer credentials come from OAuth, not from a parallel key system

An earlier draft of this change added an `api_keys` table with a workspace UI to mint long-lived
secrets. That was dropped: the workspace already runs an authorization server with consent,
per-client scopes, refresh rotation, revocation, and an audit trail. A second credential system
would duplicate all of it with weaker properties (a bare secret that must be copy-pasted through a
terminal and lives forever). The "backend can manage credentials" need is met instead by the
**Connected apps** settings view, which manages the credentials OAuth already issues.

Alternative considered: accept both. Rejected — two verifiers is exactly the duplication this change
sets out to remove.

### The REST API becomes its own protected resource

`oauthProvider` gains a third resource, `<origin>/api`, alongside the two MCP resources. A token is
accepted on `/api/*` only when its stored `resources` is exactly `[<origin>/api]`.

This matters because `enforcePerClientResources` is `false`: without a distinct resource identifier,
any MCP token would silently become a REST token, widening the MCP integrations already deployed.
Resource binding keeps the two surfaces separately revocable and separately auditable.

Alternative considered: reuse `<origin>/mcp/full`. Rejected for the widening above.

### `authenticateMcp` is extracted, not copied

The token verification moves to `worker/auth/oauth-bearer.ts` as
`verifyOAuthBearer(env, request, { resource, allowedScopes })`, returning a principal or `null`.
`worker/features/mcp/route.ts` calls it with the MCP resource; `worker/auth/session.ts` calls it with
the API resource. Every check that exists today — revoked, client disabled, token expiry, session
expiry, ban with expiry, workspace role parse, password-setup-required, consent intersection —
lives in one function, so a future fix cannot land on one surface only.

Resolution is memoized per `Request` in a `WeakMap`, so the scope middleware and the route handler
that follows it share a single D1 lookup.

### The bearer allowlist is a table, not per-route checks

`worker/auth/api-scope.ts` exports an ordered list of `{ method, pattern, scope }` entries, matched
against the request's method and pathname. Middleware registered on `apiRoutes` runs before any
route:

```
request → correlation id → bearer? ─no──────────────────────────────▶ route (cookie session)
                             │
                            yes
                             │
                   allowlist lookup ─miss─▶ 403 BEARER_NOT_ALLOWED
                             │
                            hit
                             │
                    scope satisfied? ─no──▶ 403 INSUFFICIENT_SCOPE
                             │
                            yes
                             │
                             ▶ route (getAuthContext resolves the same memoized principal)
```

Deny-by-default is the point: a new administrative route is unreachable by tokens until someone
deliberately adds it to the table, and that addition is a one-line diff a reviewer cannot miss.
Patterns use `:param` segments matched literally against path segments — no regular expressions, so
a pattern cannot accidentally match more than it reads as.

Alternative considered: a `requireScope()` call inside each handler. Rejected — it is opt-in, so
forgetting it fails open.

### `getAuthContext` gains a bearer branch, so routes need no changes

Bearer requests produce an `AuthContext` with a synthetic session id (`oauth:<tokenId>`) and
`createdAt` set to the token's issuance time. Every existing mailbox ACL check, audit entry, and
role check works unchanged. `requireRecentSession` is left alone: since infrastructure routes are
absent from the allowlist, tokens can never reach them, and a token that happens to be minutes old
still cannot pass for an interactive re-authentication.

### Last-used tracking is throttled

`oauthAccessToken` gains a nullable `lastUsedAt` column (migration `0010`). Writing it on every
request would add a D1 write to every API call, so the middleware updates it only when the stored
value is absent or older than five minutes, inside `executionCtx.waitUntil`, and failures are
swallowed. Precision is not the goal; "used this week or never used" is.

### The client is a hand-written MVU loop with no runtime dependencies

`tui/` ships zero runtime dependencies. Ink would pull React's reconciler and a Yoga WASM layout
engine into a tool whose whole value is opening instantly; a hand-written loop over `node:readline`
in raw mode plus ANSI escapes starts in milliseconds and is fully deterministic.

The structure mirrors the reference terminal browser the user cited:

```
tui/src/
  cli.ts          subcommand dispatch          store/     node:sqlite cache
  commands/       login logout search sync     sync/      cursor paging into the cache
                  status cache                 search/    query parser, filters, fuzzy scorer
  auth/           PKCE, loopback, refresh      ui/        model · update · view · keys · format
  api/            typed fetch client
```

`ui/model.ts` holds `update(model, event) → [model, effect[]]` as pure functions and `ui/view.ts`
holds `render(model) → string`. `ui/app.ts` is the only module that touches the terminal, so every
behavior in the spec is unit-testable by feeding key events to `update` and asserting on `render`
output — no pseudo-terminal needed.

Alternative considered: Ink. Rejected on startup cost and dependency weight. Alternative considered:
Go, matching the reference exactly. Rejected because the API DTOs live in TypeScript and would have
to be hand-mirrored into structs that drift silently; `tui/src/api/types.ts` is instead a direct
transcription reviewed against `worker/features/messages/types.ts`.

### Local search is instant, server search is explicit

The cache holds conversation summaries — subject, sender, recipients, snippet, folder, flags,
timestamps — and message bodies only once read. Typing filters that cache with a subsequence scorer
and structured filters, which is why it can repaint on every keystroke.

Message bodies are not in the cache until read, so a query like "the mail that mentioned the
invoice number" cannot be answered locally. `ctrl+r` sends the free-text terms to
`GET /api/conversations?search=`, which does search bodies server-side, and merges what comes back.
Making that explicit keeps a keystroke from becoming a full-table `LIKE '%…%'` scan on D1.

Known limitation: that server-side scan is unindexed today. An FTS5 index is the natural follow-up
and is deliberately out of scope here.

### Token and cache storage

Both live under XDG paths, keyed by a short hash of the workspace origin so two workspaces never
collide:

```
$XDG_CONFIG_HOME/hqbase/<origin-hash>/credentials.json   0600, dir 0700
$XDG_DATA_HOME/hqbase/<origin-hash>/cache.db             0600, dir 0700
```

Credentials are a separate file from the cache so `cache clear` cannot destroy a session and logout
cannot destroy the cache. Files are created with explicit modes and re-`chmod`ed after write, since
`umask` cannot be relied on.

Caching mail bodies on a developer laptop is a real widening of where workspace mail lives. It is
the user's explicit choice for this client; the design bounds it: owner-only permissions, bodies
only for messages actually opened, one command to erase, and the README states plainly what is
stored and where.

### Repository integration

`tui` becomes a second pnpm workspace package. It joins the existing gate rather than growing a
parallel one: `tui` is added to the architecture check roots, its tests live in `test/unit/tui/`
under the existing Vitest unit project with a `@tui` alias beside `@app` and `@worker`, and root
`typecheck` covers it. It is excluded from the coverage `include` list, whose thresholds are tuned
to the worker and app trees.

## Risks / Trade-offs

- **A bug in the allowlist matcher silently widens the API.** → The matcher is pure and unit-tested
  against traversal-ish inputs, trailing slashes, case, and extra segments; the default for any
  non-match is denial, so a matcher failure is a false negative (a broken client), never a false
  positive (an exposed route).
- **Mail bodies land on disk outside customer infrastructure.** → Owner-only permissions, bodies
  cached only when opened, `cache clear`, documented explicitly. Anyone who cannot accept it should
  not install the client; the workspace is unaffected.
- **A stolen credential file is a working credential.** → Scoped (read-only by default), revocable
  from Connected apps, visible there with a last-used timestamp, and refresh tokens rotate.
- **Terminal compatibility.** → Rendering targets plain ANSI: no mouse, no true-color requirement,
  no terminfo. Width is read from `process.stdout.columns` with a fallback, and columns collapse on
  narrow terminals the way the reference client does.
- **DTO drift between worker and client.** → An integration test asserts the API response shape the
  client parses, so a field rename fails the workspace gate rather than the user's terminal.
- **Extra D1 reads per bearer request.** → One indexed lookup on `oauthAccessToken.token`, memoized
  per request; the throttled `lastUsedAt` write is the only added write.

## Migration Plan

1. Apply migration `0010_oauth_token_activity.sql` (`ALTER TABLE oauthAccessToken ADD COLUMN
   lastUsedAt TEXT`). Additive and nullable, so the previous worker keeps running against it.
2. Deploy the worker. Registering the `<origin>/api` resource and adding the middleware changes no
   existing request path: with no `Authorization: Bearer` header the middleware is a no-op.
3. Ship `tui/` independently. It is a separate package and nothing in the workspace depends on it.

Rollback: revert the worker. Existing API tokens stop being accepted, the client reports the
workspace as unreachable, and browsers are unaffected. The added column can stay.
