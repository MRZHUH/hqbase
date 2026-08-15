import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import initialMigration from "../../../migrations/0001_initial.sql?raw";
import workspaceMigration from "../../../migrations/0002_workspace.sql?raw";
import oauthResourcesMigration from "../../../migrations/0003_oauth_resources.sql?raw";
import tokenActivityMigration from "../../../migrations/0010_oauth_token_activity.sql?raw";
import {
  listConnectedApps,
  revokeConnectedApp
} from "../../../worker/features/connected-apps/queries";

import { migrationStatements } from "./migration-statements";

const owner = "usr_apps_owner";
const other = "usr_apps_other";
const iso = "2026-07-28T12:00:00.000Z";
const future = "2099-01-01T00:00:00.000Z";

describe("connected applications", () => {
  beforeAll(async () => {
    for (const migration of [
      initialMigration,
      workspaceMigration,
      oauthResourcesMigration,
      tokenActivityMigration
    ]) {
      await applyMigration(migration);
    }

    await env.DB.batch([
      user(owner, "apps-owner@login.example"),
      user(other, "apps-other@login.example"),
      client("oc_terminal", "client_terminal", "HQBase Terminal"),
      client("oc_agent", "client_agent", "Mail Agent"),
      client("oc_unnamed", "client_unnamed", null),
      consent("con_terminal", "client_terminal", owner, ["mail:read", "mail:write"]),
      consent("con_agent", "client_agent", owner, ["mail:read"]),
      consent("con_unnamed", "client_unnamed", owner, ["mail:read"]),
      consent("con_other", "client_terminal", other, ["mail:read"]),
      token("at_terminal", "client_terminal", owner, future, null, "2026-07-28T15:00:00.000Z"),
      token("at_agent", "client_agent", owner, future, null, null),
      token("at_other", "client_terminal", other, future, null, null)
    ]);
  });

  it("lists only the caller's own authorizations", async () => {
    const apps = await listConnectedApps(env.DB, owner);
    expect(apps.map((app) => app.clientId).sort()).toEqual([
      "client_agent",
      "client_terminal",
      "client_unnamed"
    ]);

    const otherApps = await listConnectedApps(env.DB, other);
    expect(otherApps).toHaveLength(1);
    expect(otherApps[0]?.clientId).toBe("client_terminal");
  });

  it("reports granted scopes, grant time, and last use", async () => {
    const apps = await listConnectedApps(env.DB, owner);
    const terminal = apps.find((app) => app.clientId === "client_terminal");
    expect(terminal?.name).toBe("HQBase Terminal");
    expect(terminal?.scopes).toEqual(["mail:read", "mail:write"]);
    expect(terminal?.grantedAt).toBe(iso);
    expect(terminal?.lastUsedAt).toBe("2026-07-28T15:00:00.000Z");
    expect(terminal?.activeTokenCount).toBe(1);
  });

  it("marks a never-used authorization as never used", async () => {
    const apps = await listConnectedApps(env.DB, owner);
    expect(apps.find((app) => app.clientId === "client_agent")?.lastUsedAt).toBeNull();
  });

  it("falls back to the client identifier when a client has no name", async () => {
    const apps = await listConnectedApps(env.DB, owner);
    expect(apps.find((app) => app.clientId === "client_unnamed")?.name).toBe("client_unnamed");
  });

  it("revokes the consent and every credential behind it", async () => {
    expect(await revokeConnectedApp(env.DB, owner, "client_agent")).toBe(true);

    const apps = await listConnectedApps(env.DB, owner);
    expect(apps.map((app) => app.clientId)).not.toContain("client_agent");

    const revoked = await env.DB.prepare(
      `SELECT revoked FROM oauthAccessToken WHERE id = 'at_agent'`
    ).first<{ revoked: string | null }>();
    expect(revoked?.revoked).toBeTruthy();
  });

  it("cannot revoke an authorization that belongs to another user", async () => {
    expect(await revokeConnectedApp(env.DB, other, "client_unnamed")).toBe(false);

    const stillThere = await listConnectedApps(env.DB, owner);
    expect(stillThere.map((app) => app.clientId)).toContain("client_unnamed");
  });

  it("leaves another user's credentials for the same client untouched", async () => {
    expect(await revokeConnectedApp(env.DB, owner, "client_terminal")).toBe(true);

    const otherApps = await listConnectedApps(env.DB, other);
    expect(otherApps.map((app) => app.clientId)).toContain("client_terminal");
    const otherToken = await env.DB.prepare(
      `SELECT revoked FROM oauthAccessToken WHERE id = 'at_other'`
    ).first<{ revoked: string | null }>();
    expect(otherToken?.revoked).toBeNull();
  });
});

function user(id: string, email: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned)
     VALUES (?, 'Person', ?, 1, ?, ?, 'member', 0)`
  ).bind(id, email, iso, iso);
}

function client(id: string, clientId: string, name: string | null): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO oauthClient
     (id, clientId, disabled, name, redirectUris, public, requirePKCE, createdAt, updatedAt)
     VALUES (?, ?, 0, ?, ?, 1, 1, ?, ?)`
  ).bind(id, clientId, name, JSON.stringify(["http://127.0.0.1:0/callback"]), iso, iso);
}

function consent(
  id: string,
  clientId: string,
  userId: string,
  scopes: string[]
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO oauthConsent (id, clientId, userId, scopes, resources, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, clientId, userId, JSON.stringify(scopes), JSON.stringify([]), iso, iso);
}

function token(
  id: string,
  clientId: string,
  userId: string,
  expiresAt: string,
  revoked: string | null,
  lastUsedAt: string | null
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO oauthAccessToken
     (id, token, clientId, sessionId, userId, expiresAt, createdAt, scopes, resources,
      revoked, lastUsedAt)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    `hashed-${id}`,
    clientId,
    userId,
    expiresAt,
    iso,
    JSON.stringify(["mail:read"]),
    JSON.stringify([]),
    revoked,
    lastUsedAt
  );
}

async function applyMigration(sql: string): Promise<void> {
  for (const statement of migrationStatements(sql)) {
    await env.DB.prepare(statement).run();
  }
}
