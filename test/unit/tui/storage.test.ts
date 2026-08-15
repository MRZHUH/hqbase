import fs, { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cachePath, credentialsPath, normalizeOrigin, workspaceKey } from "@tui/config/paths";
import {
  type Credentials,
  deleteCredentials,
  readCredentials,
  readSettings,
  writeCredentials,
  writeSettings
} from "@tui/config/store";
import {
  countConversations,
  loadConversations,
  loadThread,
  readMeta,
  saveConversations,
  saveThread,
  writeMeta
} from "@tui/store/cache";
import { eraseCache, openCache } from "@tui/store/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sample } from "./fixtures";

const origin = "https://mail.example.com";
const other = "https://other.example.com";
let root: string;
let previous: { config?: string | undefined; data?: string | undefined };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "hqbase-tui-"));
  previous = { config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME };
  process.env.XDG_CONFIG_HOME = path.join(root, "config");
  process.env.XDG_DATA_HOME = path.join(root, "data");
});

afterEach(() => {
  if (previous.config === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous.config;
  if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous.data;
  fs.rmSync(root, { recursive: true, force: true });
});

function credentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    origin,
    clientId: "client_test",
    clientSecret: null,
    accessToken: "hqb_access_secret-value",
    refreshToken: "hqb_refresh_secret-value",
    expiresAt: Date.now() + 3600_000,
    scopes: ["mail:read", "offline_access"],
    ...overrides
  };
}

function mode(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

describe("workspace paths", () => {
  it("files each workspace under its own directory", () => {
    expect(workspaceKey(origin)).not.toBe(workspaceKey(other));
    expect(credentialsPath(origin)).not.toBe(credentialsPath(other));
    expect(cachePath(origin)).not.toBe(cachePath(other));
  });

  it("does not put the hostname in the path", () => {
    expect(cachePath(origin)).not.toContain("mail.example.com");
  });

  it("keeps the cache and the credentials in separate trees", () => {
    expect(path.dirname(cachePath(origin))).not.toBe(path.dirname(credentialsPath(origin)));
  });

  it("normalizes an origin so a trailing path cannot fork the key", () => {
    expect(normalizeOrigin("https://mail.example.com/app/")).toBe(origin);
    expect(workspaceKey("https://mail.example.com/app")).toBe(workspaceKey(origin));
  });
});

describe("credential storage", () => {
  it("round-trips the credential", () => {
    writeCredentials(credentials());
    expect(readCredentials(origin)).toMatchObject({
      clientId: "client_test",
      accessToken: "hqb_access_secret-value",
      scopes: ["mail:read", "offline_access"]
    });
  });

  it("stores the credential owner-only inside an owner-only directory", () => {
    writeCredentials(credentials());
    expect(mode(credentialsPath(origin))).toBe(0o600);
    expect(mode(path.dirname(credentialsPath(origin)))).toBe(0o700);
  });

  it("narrows a file that already existed with wide permissions", () => {
    writeCredentials(credentials());
    fs.chmodSync(credentialsPath(origin), 0o644);
    writeCredentials(credentials());
    expect(mode(credentialsPath(origin))).toBe(0o600);
  });

  it("keeps two workspaces apart", () => {
    writeCredentials(credentials());
    writeCredentials(credentials({ origin: other, accessToken: "hqb_access_other" }));
    expect(readCredentials(origin)?.accessToken).toBe("hqb_access_secret-value");
    expect(readCredentials(other)?.accessToken).toBe("hqb_access_other");
  });

  it("reports no credential rather than throwing when none is stored", () => {
    expect(readCredentials(origin)).toBeNull();
  });

  it("ignores a corrupt credential file", () => {
    fs.mkdirSync(path.dirname(credentialsPath(origin)), { recursive: true });
    fs.writeFileSync(credentialsPath(origin), "not json");
    expect(readCredentials(origin)).toBeNull();
  });

  it("removes only the named workspace on delete", () => {
    writeCredentials(credentials());
    writeCredentials(credentials({ origin: other }));
    deleteCredentials(origin);
    expect(readCredentials(origin)).toBeNull();
    expect(readCredentials(other)).not.toBeNull();
  });

  it("remembers the default workspace owner-only", () => {
    writeSettings({ defaultOrigin: origin });
    expect(readSettings().defaultOrigin).toBe(origin);
  });
});

describe("cache", () => {
  it("creates the cache file owner-only inside an owner-only directory", () => {
    const db = openCache(origin);
    db.close();
    expect(mode(cachePath(origin))).toBe(0o600);
    expect(mode(path.dirname(cachePath(origin)))).toBe(0o700);
  });

  it("survives being closed and reopened", () => {
    const first = openCache(origin);
    saveConversations(first, sample);
    first.close();

    const second = openCache(origin);
    expect(countConversations(second)).toBe(sample.length);
    expect(loadConversations(second).map((row) => row.id)).toEqual(["c1", "c2", "c3"]);
    second.close();
  });

  it("counts an existing conversation as updated, not added", () => {
    const db = openCache(origin);
    expect(saveConversations(db, sample)).toEqual({ added: 3, updated: 0 });
    expect(saveConversations(db, sample)).toEqual({ added: 0, updated: 3 });
    db.close();
  });

  it("keeps two workspaces in separate files", () => {
    const first = openCache(origin);
    saveConversations(first, sample);
    first.close();

    const second = openCache(other);
    expect(countConversations(second)).toBe(0);
    second.close();
  });

  it("stores and reorders thread bodies chronologically", () => {
    const db = openCache(origin);
    saveThread(db, "thr_c1", [
      body("m2", "2026-08-15T12:00:00.000Z"),
      body("m1", "2026-08-15T09:00:00.000Z")
    ]);
    expect(loadThread(db, "thr_c1").map((message) => message.id)).toEqual(["m1", "m2"]);
    db.close();
  });

  it("round-trips sync metadata", () => {
    const db = openCache(origin);
    expect(readMeta(db, "last_sync_at")).toBeNull();
    writeMeta(db, "last_sync_at", "2026-08-15T12:00:00.000Z");
    writeMeta(db, "last_sync_at", "2026-08-15T13:00:00.000Z");
    expect(readMeta(db, "last_sync_at")).toBe("2026-08-15T13:00:00.000Z");
    db.close();
  });

  it("erases the cache without touching the credential", () => {
    writeCredentials(credentials());
    const db = openCache(origin);
    saveConversations(db, sample);
    db.close();

    eraseCache(origin);
    expect(fs.existsSync(cachePath(origin))).toBe(false);
    expect(readCredentials(origin)).not.toBeNull();

    const reopened = openCache(origin);
    expect(countConversations(reopened)).toBe(0);
    reopened.close();
  });
});

function body(id: string, receivedAt: string) {
  return {
    id,
    threadId: "thr_c1",
    mailboxId: "mbx_team",
    direction: "inbound" as const,
    folder: "inbox",
    fromAddress: "alice@example.com",
    to: ["team@example.com"],
    cc: [],
    bcc: [],
    subject: "Quarterly review",
    snippet: "Numbers",
    receivedAt,
    sentAt: null,
    readAt: null,
    starredAt: null,
    hasAttachments: false,
    createdAt: receivedAt,
    textBody: "Body",
    htmlAvailable: false,
    attachments: []
  };
}
