# Changelog

## Unreleased

- Add `hqbase-mail`, a terminal client for a workspace, with type-ahead search over a local cache,
  a thread reader, message actions, and workspace-side body search.
- Authorize non-browser clients with OAuth authorization code and PKCE against the workspace's own
  authorization server, and accept those access tokens on the REST API for an explicit allowlist of
  mail routes, deny-by-default everywhere else.
- Add Settings › Applications, where a user can see every application they authorized, the scopes it
  holds, when it was last used, and revoke it.
- Show the whole message envelope in the terminal reader — sender, every recipient, carbon copies,
  absolute and relative dates, and each attachment — and draw image attachments inline on terminals
  that support it, describing them in text everywhere else.
- Distinguish read from unread conversations by weight and colour, act on a conversation without
  opening it through a menu on enter, and mark everything currently listed as read behind a
  confirmation.
- Measure every terminal line in display columns, so mailboxes in Chinese, Japanese, or Korean
  render without wrapping or corrupting the frame.

## 1.0.1

- Preserve invitation password setup links so `/set-password?token=...` reaches the password form
  instead of being normalized to the inbox.

## 1.0.0

- Publish HQBase as one free and open-source shared email workspace for customer-owned Cloudflare
  infrastructure, with one signed public release and update channel.
- Support multiple email domains, shared mailboxes, aliases, catch-all delivery, drafts,
  conversations, replies, forwarding, attachments, and Gmail-compatible quoted history.
- Enforce owner, admin, member, and mailbox-level read, agent, and manager access throughout the app
  and OAuth-protected MCP endpoints.
- Provide responsive desktop, mobile, and installable PWA experiences with mailbox filtering,
  notifications, offline handling, update readiness, and device-safe layouts.
- Keep setup, domain management, updates, backup, restore, diagnostics, and resource removal inside
  the customer Cloudflare account.
- Use the verified public Cloudflare OAuth client by default and support private customer-managed
  OAuth clients with Authorization Code and PKCE, without client secrets or pasted API tokens.
- Verify signed release manifests and artifact digests before deployment, with compatibility
  checks, D1 recovery bookmarks, Worker rollback details, and staging lifecycle coverage.
