# HQBase

Your team’s email workspace. On your infrastructure.

HQBase is an AGPL-licensed shared email workspace that runs in your Cloudflare account. It provides
shared mailboxes, team access controls, multi-domain setup, drafts, audit history, operations, and
an OAuth-protected remote MCP server while keeping mail and Cloudflare credentials in customer
infrastructure.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FHQBase%2Fhqbase)

## Local development

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

Set `BETTER_AUTH_SECRET` and a local-only `HQBASE_LOCAL_SEED_PASSWORD` of 8 to 128 characters in
`.dev.vars` before running the optional seed command. It writes only to local D1 and does not contact
Cloudflare OAuth. Open `http://localhost:8787/` and sign in as `owner@hqbase.test` with that
password.

To discard all local D1 data, rebuild the schema, and recreate the demo workspace:

```sh
pnpm db:reset:local
pnpm db:seed:local
```

The reset command is destructive and local-only. To exercise first-run setup instead, omit the seed
command and open `http://localhost:8787/setup`.

For presentation-only onboarding work:

```sh
pnpm dev:setup-ui
```

Open `http://127.0.0.1:5173/__ui/setup`.

## Terminal client

`tui/` is a terminal client for a workspace: `hqbase-mail` opens a full-screen search over your
shared mailboxes, reads threads, and triages mail without a browser. It authorizes with OAuth and
PKCE against the workspace's own authorization server, so no password or shared secret is typed into
a terminal, and every authorization can be revoked from Settings › Applications.

```sh
pnpm tui:build
npm install -g ./tui
hqbase-mail login https://mail.example.com
```

See `tui/README.md` for the query language, key bindings, and exactly what the client caches on
disk.

## Quality gate

```sh
pnpm check
pnpm deploy:dry-run
```

Run `pnpm cf:typegen` after changing `wrangler.jsonc`.

## Documentation

[hqbase.io/docs](https://hqbase.io/docs/) is the single public home for user and operator guides,
canonical product specifications, and maintainer procedures.

Pushes to `main` run the full quality gate and deployment dry-run. Deployed staging is manual and
also runs inside the signed release workflow. A release stays draft while the previous stable
version is upgraded to the exact signed candidate; only a passing candidate becomes public.
Customer installations and updates verify the signed manifest and artifact digest before
deployment.

## License

HQBase is licensed under AGPL-3.0-only. See `LICENSE`.
