# Handoff — pre-commit / PR preparation

Written at the end of the implementation session. Everything below was verified on
`feat/tui-client`, not assumed.

## What is on the branch

Four commits, oldest first:

| Commit | What it does |
| --- | --- |
| `8af5779` | `tui/` package (`hqbase-mail`), OAuth bearer auth for `/api/*`, Connected apps settings, migration `0010` |
| `8c51397` | Discovery reports "this workspace predates terminal sign-in" instead of a raw JSON parse error |
| `5eeb754` | Key-hint line, arrow navigation, full message envelope in the reader, inline images |
| `942c528` | Terminal-column measurement (CJK), read/unread colour, action menu, mark-all-read |

Touched areas: `tui/`, `test/unit/tui/`, `test/integration/worker/{api-bearer,connected-apps}.test.ts`,
`worker/auth/{oauth-bearer,api-scope,session,auth}.ts`, `worker/routes/{bearer,index}.ts`,
`worker/features/connected-apps/`, `worker/features/mcp/route.ts`, `worker/index.ts`,
`app/features/settings/connected-apps-*`, `app/lib/routes.ts`, `migrations/0010_*.sql`,
`openspec/changes/add-tui-client/`, and the repo wiring (`pnpm-workspace.yaml`, `package.json`,
`tsconfig.json`, `vitest.config.ts`, `scripts/check-architecture.mjs`, `README.md`, `CHANGELOG.md`).

## Gate results

Verified in this order, on the branch as committed:

- `pnpm code:check` — passes
- `pnpm typecheck` (root and `tui`) — passes
- `pnpm test:unit` — 538 pass, 2 skipped, **1 pre-existing failure** (see below)
- coverage — global thresholds pass (lines 37.41 / branches 36.53 / functions 34.25 / statements 38.23)
- `pnpm test:integration` — 53 pass
- `pnpm test:architecture` — passes with 8 warnings, all of them pre-existing files over the 300-line
  review threshold plus `tui/src/ui/update.ts`
- `pnpm build` and `pnpm deploy:dry-run` — pass

**The one failure is not from this branch.** `test/unit/app/compose/use-draft-autosave.test.tsx`
fails with `Cannot read properties of undefined (reading 'setItem')`: Node 26 no longer exposes
`localStorage` to the happy-dom environment without `--localstorage-file`. This was reproduced on
`main` with the original lockfile before any of this work landed. It also produces the only coverage
threshold errors, which are for that same file. Say so in the PR description so a reviewer does not
attribute it to the branch.

## Before opening the PR

1. **Do not include the working tree's other edits.** `worker/features/setup/*`,
   `app/features/setup/*`, `app/features/mcp/consent-page.tsx`, `scripts/hqbase/config.mjs` and the
   `MailboxScope` refactor across `worker/auth/mailbox-access.ts`,
   `worker/features/messages/*` belong to separate work and are deliberately unstaged. They want
   their own commits.
2. **Deployment ordering matters.** Migration `0010` adds `oauthAccessToken.lastUsedAt`. It must be
   applied before the Worker is deployed: the shared bearer verifier selects that column, and
   without it every MCP and API bearer request answers 401. The column is nullable and additive, so
   applying it ahead of the deploy is safe for the running Worker.
3. `pnpm-lock.yaml` carries an unavoidable patch-level bump of `sonner` and `@types/react-dom`,
   picked up when `tui` joined the workspace.
4. The workspace at the operator's own deployment already runs this branch — it was deployed from
   source during the session to exercise the login flow. A `*.workers.dev` subdomain was enabled as
   a side effect, because `workers_dev` is not set in `wrangler.jsonc`. Worth deciding whether to
   set `"workers_dev": false` before release.

## Suggested PR description

> ### Terminal client and OAuth bearer auth for the REST API
>
> Adds `hqbase-mail`, a zero-dependency terminal client for a workspace, and the server surface it
> needs.
>
> **Client.** Full-screen search over a local SQLite cache, so typing re-filters without a request;
> `ctrl+r` sends the free-text half of the query to the workspace, which searches message bodies the
> cache does not hold. Reads threads with the whole envelope — sender, recipients, carbon copies,
> dates, attachments — and draws image attachments inline on terminals that support it. Triage with
> a menu on enter, or `ctrl+u` to mark everything listed as read. Read and unread are distinguished
> by weight and colour. The interface is a pure `update`/`render` pair; only `ui/app.ts` touches the
> terminal, so every behaviour is tested without a pseudo-terminal.
>
> **Authorization.** OAuth 2.1 authorization code with PKCE against the workspace's own
> authorization server, using dynamic client registration and a loopback redirect. No password is
> typed into the terminal and no shared secret is stored. Read-only unless `login --write`.
>
> **Server.** `/api/*` accepts access tokens bound to a new `<origin>/api` protected resource, gated
> by one deny-by-default allowlist that runs before every route, so a mail token can never reach an
> administrative one whatever the owner's role. Credential management is deliberately absent from
> that allowlist. The token verification that lived inside the MCP route is extracted and shared, so
> revocation, expiry, ban and password-setup checks have one implementation. Settings gains an
> Applications tab for reviewing and revoking authorizations.
>
> Migration `0010` adds a nullable `oauthAccessToken.lastUsedAt`, written at most once every five
> minutes. **Apply it before deploying the Worker.**
>
> Note for reviewers: `test/unit/app/compose/use-draft-autosave.test.tsx` fails on `main` as well on
> Node 26 (happy-dom no longer gets `localStorage` without `--localstorage-file`); it is unrelated to
> this change.
