import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import conversationMigration from "../../../migrations/0004_conversations.sql?raw";
import threadRebuildMigration from "../../../migrations/0005_rebuild_threads.sql?raw";
import pushNotificationMigration from "../../../migrations/0006_push_notifications.sql?raw";
import mailPreferenceMigration from "../../../migrations/0007_user_mail_preferences.sql?raw";
import userOnboardingMigration from "../../../migrations/0008_user_onboarding.sql?raw";
import loginEmailDomainMigration from "../../../migrations/0009_login_email_domain_isolation.sql?raw";
import tokenActivityMigration from "../../../migrations/0010_oauth_token_activity.sql?raw";
import { hashOAuthToken } from "../../../worker/auth/oauth-token";

import { migrationStatements } from "./migration-statements";

const origin = "https://hqbase.test";
const apiResource = `${origin}/api`;
const userId = "usr_api_member";
const sessionId = "ses_api_member";

const readSecret = "api-hqbase-read";
const writeSecret = "api-hqbase-write";
const mcpSecret = "api-hqbase-mcp-bound";
const expiredSecret = "api-hqbase-expired";
const revokedSecret = "api-hqbase-revoked";

const readToken = `hqb_access_${readSecret}`;
const writeToken = `hqb_access_${writeSecret}`;
const mcpBoundToken = `hqb_access_${mcpSecret}`;
const expiredToken = `hqb_access_${expiredSecret}`;
const revokedToken = `hqb_access_${revokedSecret}`;

describe("REST API bearer authentication", () => {
  beforeAll(async () => {
    for (const migration of [
      initialMigration,
      workspaceMigration,
      oauthResourcesMigration,
      conversationMigration,
      threadRebuildMigration,
      pushNotificationMigration,
      mailPreferenceMigration,
      userOnboardingMigration,
      loginEmailDomainMigration,
      tokenActivityMigration
    ]) {
      await applyMigration(migration);
    }

    const now = new Date();
    const iso = now.toISOString();
    const hour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const past = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned)
         VALUES (?, 'API Member', 'api-member@login.example', 1, ?, ?, 'member', 0)`
      ).bind(userId, iso, iso),
      env.DB.prepare(
        `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         VALUES (?, ?, 'session-token-api-hqbase', ?, ?, ?)`
      ).bind(sessionId, hour, iso, iso, userId),
      env.DB.prepare(
        `INSERT INTO mailboxes (id, address, display_name, is_active, created_at, updated_at)
         VALUES ('mbx_api', 'team@example.com', 'Team', 1, ?, ?)`
      ).bind(iso, iso),
      env.DB.prepare(
        `INSERT INTO mailbox_grants
         (mailbox_id, user_id, access_level, created_by, created_at, updated_at)
         VALUES ('mbx_api', ?, 'agent', ?, ?, ?)`
      ).bind(userId, userId, iso, iso),
      env.DB.prepare(
        `INSERT INTO oauthClient
         (id, clientId, disabled, name, redirectUris, public, requirePKCE, createdAt, updatedAt)
         VALUES ('oc_api', 'client_api', 0, 'HQBase Terminal', ?, 1, 1, ?, ?)`
      ).bind(JSON.stringify(["http://127.0.0.1:0/callback"]), iso, iso),
      env.DB.prepare(
        `INSERT INTO oauthConsent
         (id, clientId, userId, scopes, resources, createdAt, updatedAt)
         VALUES ('consent_api', 'client_api', ?, ?, ?, ?, ?)`
      ).bind(
        userId,
        JSON.stringify(["mail:read", "mail:write"]),
        JSON.stringify([apiResource]),
        iso,
        iso
      ),
      env.DB.prepare(
        `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at)
         VALUES ('thr_api', 'api bearer', ?, ?, ?)`
      ).bind(iso, iso, iso),
      env.DB.prepare(
        `INSERT INTO messages (
          id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json,
          subject, snippet, text_body, message_id, dedupe_key, in_reply_to, references_json,
          received_at, sent_at, read_at, has_attachments, created_at, updated_at
        ) VALUES (
          'msg_api', 'thr_api', 'mbx_api', 'inbound', 'inbox', 'sender@example.com', ?, '[]', '[]',
          'Quarterly review', 'Body text', 'Body text', '<api@example.com>',
          'api:team@example.com', NULL, '[]', ?, NULL, NULL, 0, ?, ?
        )`
      ).bind(JSON.stringify(["team@example.com"]), iso, iso, iso)
    ]);

    await insertToken("at_read", readSecret, ["mail:read"], [apiResource], hour, null);
    await insertToken(
      "at_write",
      writeSecret,
      ["mail:read", "mail:write"],
      [apiResource],
      hour,
      null
    );
    await insertToken("at_mcp", mcpSecret, ["mail:read"], [`${origin}/mcp`], hour, null);
    await insertToken("at_expired", expiredSecret, ["mail:read"], [apiResource], past, null);
    await insertToken("at_revoked", revokedSecret, ["mail:read"], [apiResource], hour, iso);
  });

  it("publishes protected resource metadata for the API", async () => {
    const response = await SELF.fetch(`${origin}/.well-known/oauth-protected-resource/api`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };
    expect(body.resource).toBe(apiResource);
    expect(body.authorization_servers).toEqual([`${origin}/api/auth`]);
    expect(body.scopes_supported).toEqual(["mail:read", "mail:write", "mail:send"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
  });

  it("authenticates a listed read route with a read token", async () => {
    const response = await SELF.fetch(`${origin}/api/me`, {
      headers: { authorization: `Bearer ${readToken}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; email: string };
    expect(body.id).toBe(userId);
    expect(body.email).toBe("api-member@login.example");
  });

  it("serves conversations the token owner can read", async () => {
    const response = await SELF.fetch(`${origin}/api/conversations?search=Quarterly`, {
      headers: { authorization: `Bearer ${readToken}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { conversations: Array<{ subject: string }> };
    expect(body.conversations.map((row) => row.subject)).toContain("Quarterly review");
  });

  it("records that the token was used", async () => {
    await SELF.fetch(`${origin}/api/me`, {
      headers: { authorization: `Bearer ${readToken}` }
    });
    const row = await env.DB.prepare(
      `SELECT lastUsedAt FROM oauthAccessToken WHERE id = 'at_read'`
    ).first<{ lastUsedAt: string | null }>();
    expect(row?.lastUsedAt).toBeTruthy();
  });

  it("refuses a write action to a read-only token", async () => {
    const response = await SELF.fetch(`${origin}/api/conversations/msg_api/archive`, {
      body: JSON.stringify({ folder: "inbox" }),
      headers: { authorization: `Bearer ${readToken}`, "content-type": "application/json" },
      method: "POST"
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("allows a write action to a token holding the write scope", async () => {
    const response = await SELF.fetch(`${origin}/api/conversations/msg_api/star`, {
      body: JSON.stringify({ folder: "inbox" }),
      headers: { authorization: `Bearer ${writeToken}`, "content-type": "application/json" },
      method: "POST"
    });
    expect(response.status).toBe(200);
  });

  it("refuses every route absent from the allowlist", async () => {
    for (const path of ["/api/users", "/api/audit", "/api/connected-apps", "/api/setup/status"]) {
      const response = await SELF.fetch(`${origin}${path}`, {
        headers: { authorization: `Bearer ${writeToken}` }
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("BEARER_NOT_ALLOWED");
    }
  });

  it("refuses a token bound to the MCP resource", async () => {
    const response = await SELF.fetch(`${origin}/api/me`, {
      headers: { authorization: `Bearer ${mcpBoundToken}` }
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/api"
    );
  });

  it("refuses expired, revoked, and unknown tokens alike", async () => {
    for (const token of [expiredToken, revokedToken, "hqb_access_never-issued"]) {
      const response = await SELF.fetch(`${origin}/api/me`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.status).toBe(401);
    }
  });

  it("leaves cookie-authenticated requests unchanged", async () => {
    const response = await SELF.fetch(`${origin}/api/me`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    // No bearer header, so the scope middleware never runs and the route's own
    // session check is what answers.
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});

async function insertToken(
  id: string,
  secret: string,
  scopes: string[],
  resources: string[],
  expiresAt: string,
  revoked: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO oauthAccessToken
     (id, token, clientId, sessionId, userId, expiresAt, createdAt, scopes, resources, revoked)
     VALUES (?, ?, 'client_api', ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      await hashOAuthToken(secret),
      sessionId,
      userId,
      expiresAt,
      now,
      JSON.stringify(scopes),
      JSON.stringify(resources),
      revoked
    )
    .run();
}

async function applyMigration(sql: string): Promise<void> {
  for (const statement of migrationStatements(sql)) {
    await env.DB.prepare(statement).run();
  }
}
