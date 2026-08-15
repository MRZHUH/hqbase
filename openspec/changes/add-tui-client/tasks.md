## 1. Shared OAuth bearer verification

- [x] 1.1 Add migration `0010_oauth_token_activity.sql` adding the nullable `lastUsedAt` column to `oauthAccessToken`
- [x] 1.2 Add `apiResource()` to `worker/auth/auth.ts` and register `<origin>/api` in the `oauthProvider` resources list
- [x] 1.3 Create `worker/auth/oauth-bearer.ts` with `verifyOAuthBearer()` carrying every check `authenticateMcp` performs, memoized per `Request`
- [x] 1.4 Add `touchOAuthToken()` to the same module, writing `lastUsedAt` only when absent or older than five minutes
- [x] 1.5 Rewrite `worker/features/mcp/route.ts::authenticateMcp` to delegate to `verifyOAuthBearer`, preserving its 401 challenge behavior
- [x] 1.6 Unit-test the bearer verifier: valid token, wrong resource, revoked, expired token, expired session, disabled client, banned user, password-setup-required, consent-narrowed scopes

## 2. REST bearer surface

- [x] 2.1 Create `worker/auth/api-scope.ts` with the allowlist table and a pure `apiScopeFor(method, pathname)` matcher
- [x] 2.2 Unit-test the matcher for hits, misses, `:param` segments, trailing slashes, extra segments, and unknown methods
- [x] 2.3 Add the bearer branch to `getAuthContext()` in `worker/auth/session.ts`, producing a synthetic `oauth:<tokenId>` session
- [x] 2.4 Add the scope middleware to `worker/routes/index.ts`, returning `BEARER_NOT_ALLOWED` and `INSUFFICIENT_SCOPE`, and scheduling the throttled last-used write
- [x] 2.5 Serve `/.well-known/oauth-protected-resource/api` metadata and the `WWW-Authenticate` challenge for failed bearer requests
- [x] 2.6 Integration-test the REST bearer surface end to end: allowed route, scope-gated route, unlisted route, wrong-resource token, cookie session unaffected

## 3. Connected apps

- [x] 3.1 Create `worker/features/connected-apps/queries.ts` reading the caller's consents with granted scopes, first-granted time, and last-used time
- [x] 3.2 Create `worker/features/connected-apps/routes.ts` with list and revoke, both scoped to the caller's own authorizations, revoke recording an audit entry
- [x] 3.3 Register the route in `worker/routes/index.ts` and confirm it is absent from the bearer allowlist
- [x] 3.4 Integration-test listing, revoking, that a revoked token is refused afterwards, and that one user cannot revoke another's authorization
- [x] 3.5 Add `app/features/settings/connected-apps-*` (types, data hook, section) rendering the list with a confirmation before revoke
- [x] 3.6 Add the settings tab in `app/lib/routes.ts` and `app/features/settings/settings-page.tsx`

## 4. Terminal client foundations

- [x] 4.1 Create the `tui/` package: `package.json` (`@hqbase/tui`, `hqbase-mail` bin, no runtime dependencies), `tsconfig.json`, `.gitignore`
- [x] 4.2 Register `tui` in `pnpm-workspace.yaml`, the root `typecheck`/`check` scripts, `tsconfig.json`, the `@tui` alias in `vitest.config.ts`, and the architecture-check roots
- [x] 4.3 Implement `tui/src/config/paths.ts` (XDG paths, per-origin hash) and `config/store.ts` (owner-only read/write of config and credentials)
- [x] 4.4 Implement `tui/src/api/types.ts` transcribing the conversation, message, thread, and mailbox DTOs, and `api/client.ts` with bearer auth, error mapping, and one refresh-and-retry
- [x] 4.5 Implement `tui/src/store/db.ts` (`node:sqlite` schema, owner-only file) and `store/cache.ts` (upsert and query conversations, cache message bodies, sync metadata)
- [x] 4.6 Implement `tui/src/sync/sync.ts` pulling conversation pages by cursor into the cache and reporting added/updated counts

## 5. Terminal client authorization

- [x] 5.1 Implement `tui/src/auth/pkce.ts` (verifier, challenge, state) and `auth/discovery.ts` (authorization-server and protected-resource metadata)
- [x] 5.2 Implement `tui/src/auth/loopback.ts`: ephemeral-port listener, state comparison, success and failure pages, timeout
- [x] 5.3 Implement `tui/src/auth/oauth.ts`: dynamic client registration, authorization URL, code exchange, refresh, revoke
- [x] 5.4 Implement the `login` and `logout` commands, including the printed URL fallback and the read-only-by-default scope choice
- [x] 5.5 Unit-test PKCE generation, state mismatch rejection, redirect parsing, and that no secret appears in any rendered message

## 6. Terminal client search and interface

- [x] 6.1 Implement `tui/src/search/query.ts` parsing free text plus `from: to: subject: mailbox: is: has: in: newer: older:` and reporting invalid terms
- [x] 6.2 Implement `tui/src/search/filter.ts` and `search/fuzzy.ts`, ranking by match quality then recency
- [x] 6.3 Implement `tui/src/ui/model.ts` as pure `update(model, event) → [model, effects]` covering typing, movement, paging, open, back, actions, deep search, sync, notices
- [x] 6.4 Implement `tui/src/ui/view.ts` as a pure `render(model) → string` with the query line, column-collapsing list, thread reader, and status line
- [x] 6.5 Implement `tui/src/ui/keys.ts`, `ui/format.ts`, `ui/ansi.ts`, and `ui/app.ts` (the only module touching the terminal: alternate screen, raw mode, resize, restore on exit and interrupt)
- [x] 6.6 Implement the non-interactive `search`, `sync`, `status`, `cache clear`, and `version` commands, and `cli.ts` dispatch
- [x] 6.7 Unit-test the query parser, filters, fuzzy ranking, formatter, and the update reducer across every spec scenario

## 8. Navigation, key hints, and rich message display

- [x] 8.1 Add a dedicated key-hint line as the last row of the frame, context-sensitive to list or reader, with the quit binding pinned so a narrow terminal never drops it
- [x] 8.2 Bind the right arrow to open a conversation and the left arrow to leave the reader or clear the query, never to quit
- [x] 8.3 Move query-cursor movement to the readline bindings now that the arrows are spoken for
- [x] 8.4 Rewrite the reader as row-counted blocks (`ui/reader.ts`) so a block taller than one row windows correctly
- [x] 8.5 Show From, To, Cc, Bcc, absolute and relative Date, and a Flags line naming attachments, images, an HTML part, and unread state
- [x] 8.6 List every attachment with its content type, size, and whether the message referenced it inline
- [x] 8.7 Add `ui/images.ts`: protocol detection (iTerm2, Kitty, off inside multiplexers) and encoding, with chunking for Kitty
- [x] 8.8 Fetch image attachments under a size cap as an effect, and render loading, ready, unsupported, oversized, and failed states
- [x] 8.9 Cap image height to the window so a short terminal shrinks the image instead of dropping it
- [x] 8.10 Add `clip()` alongside `truncate()`, because collapsing whitespace destroyed header alignment and list indentation
- [x] 8.11 Unit-test protocol detection and encoding, reader blocks and windowing, the new bindings, and the hint line

## 9. Column-correct rendering, colour, and triage actions

- [x] 9.1 Add `tui/src/ui/width.ts`: per-code-point column widths, wide and combining ranges, East Asian Ambiguous reserved at two columns, and escape-aware measurement
- [x] 9.2 Move `pad`, `clip`, `truncate`, and `wrap` onto display columns, never splitting a wide character
- [x] 9.3 Reserve the last terminal column in `layout` and every status, hint, and reader line
- [x] 9.4 Disable autowrap while the alternate screen is active and restore it on exit
- [x] 9.5 Widen the flag column to six columns so all four ambiguous-width markers fit
- [x] 9.6 Rewrite `ui/ansi.ts` for composable SGR, so selection and read state apply as one sequence instead of nesting resets
- [x] 9.7 Render unread rows bold, read rows dim, and starred rows tinted
- [x] 9.8 Add the action overlay: model state, modal key handling in `ui/overlay.ts`, and an ASCII-framed box
- [x] 9.9 Bind enter to the action menu, keep the right arrow for reading, and add `ctrl+u` mark-all-read behind a confirmation
- [x] 9.10 Add the `mark-all-read` effect, applying per conversation and reporting how many succeeded
- [x] 9.11 Unit-test column arithmetic, CJK rows, box alignment, the menu, the confirmation, and read/unread styling

## 7. Gate and documentation

- [x] 7.1 Write `tui/README.md`: install, login, key bindings, query language, and exactly what is stored on disk and how to erase it
- [x] 7.2 Note the terminal client and Connected apps in the root `README.md` and `CHANGELOG.md`
- [x] 7.3 Run `pnpm check` and `pnpm deploy:dry-run` and resolve every failure
- [x] 7.4 Review the diff for private data — no real domains, account, database, or deployment identifiers — then commit on a branch

## Notes

- `pnpm check` passes except `test/unit/app/compose/use-draft-autosave.test.tsx`, which fails on this
  machine before this change as well: Node 26 no longer exposes `localStorage` to the happy-dom
  environment without `--localstorage-file`. Verified by reinstalling the original lockfile at
  `main` and reproducing the same `Cannot read properties of undefined (reading 'setItem')`.
- `test/integration/worker/mcp.test.ts` now applies migration `0010`. Without it the shared bearer
  verifier cannot read `lastUsedAt` and every MCP request 401s, which is the same ordering the
  migration plan calls out: apply the migration before deploying the Worker.
- Two rendering defects the user hit were real and are fixed in section 9: rows were measured with
  `String.length`, so any CJK subject overflowed the terminal and wrapped, and every row was exactly
  the terminal width, which put the terminal into deferred wrap and bled the selected row's
  background onto the next line.
- The `MailboxScope` refactor that appeared in the working tree mid-session (`worker/auth/mailbox-access.ts`,
  `worker/features/messages/conversation-queries.ts` and their call sites) is not part of this change
  and was left alone; it briefly failed `pnpm typecheck` while in flight and passes now.
- The commit carries the working tree's pre-existing edits to `worker/routes/index.ts` and
  `worker/features/mcp/route.ts`, because this change edits the same files. The uncommitted
  `revoked IS NULL` check on access tokens was preserved into `worker/auth/oauth-bearer.ts`. Every
  other pre-existing edit in the tree (setup, Cloudflare, `wrangler.jsonc`, `worker-configuration.d.ts`)
  was left unstaged.
