import { apiScopeFor, bearerAllowlist } from "@worker/auth/api-scope";
import { describe, expect, it } from "vitest";

describe("apiScopeFor", () => {
  it("grants read scope to the listed read routes", () => {
    expect(apiScopeFor("GET", "/api/me")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/mailboxes")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/conversations")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/messages/msg_123")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/messages/msg_123/thread")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/attachments/att_1")).toBe("mail:read");
  });

  it("charges write scope for state changes", () => {
    expect(apiScopeFor("POST", "/api/conversations/msg_1/archive")).toBe("mail:write");
    expect(apiScopeFor("POST", "/api/messages/msg_1/star")).toBe("mail:write");
  });

  it("refuses every route it does not list", () => {
    expect(apiScopeFor("GET", "/api/users")).toBeNull();
    expect(apiScopeFor("POST", "/api/users")).toBeNull();
    expect(apiScopeFor("GET", "/api/setup/status")).toBeNull();
    expect(apiScopeFor("GET", "/api/audit")).toBeNull();
    expect(apiScopeFor("GET", "/api/connected-apps")).toBeNull();
    expect(apiScopeFor("DELETE", "/api/connected-apps/client_1")).toBeNull();
    expect(apiScopeFor("POST", "/api/auth/sign-in/email")).toBeNull();
    expect(apiScopeFor("GET", "/api/drafts")).toBeNull();
    expect(apiScopeFor("POST", "/api/send")).toBeNull();
  });

  it("matches the method exactly", () => {
    expect(apiScopeFor("POST", "/api/me")).toBeNull();
    expect(apiScopeFor("DELETE", "/api/messages/msg_1")).toBeNull();
    expect(apiScopeFor("get", "/api/me")).toBe("mail:read");
  });

  it("treats a parameter as exactly one segment", () => {
    expect(apiScopeFor("GET", "/api/messages")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api/messages/msg_1/thread/extra")).toBeNull();
    expect(apiScopeFor("GET", "/api/messages/msg_1/html")).toBeNull();
    expect(apiScopeFor("POST", "/api/conversations/archive")).toBeNull();
  });

  it("tolerates a trailing slash and nothing else empty", () => {
    expect(apiScopeFor("GET", "/api/me/")).toBe("mail:read");
    expect(apiScopeFor("GET", "/api//me")).toBeNull();
    expect(apiScopeFor("GET", "//api/me")).toBeNull();
  });

  it("refuses unnormalized paths rather than resolving them", () => {
    expect(apiScopeFor("GET", "/api/messages/../users")).toBeNull();
    expect(apiScopeFor("GET", "/api/./me")).toBeNull();
    expect(apiScopeFor("GET", "/api/users/../me")).toBeNull();
  });

  it("is case sensitive on path segments", () => {
    expect(apiScopeFor("GET", "/API/ME")).toBeNull();
    expect(apiScopeFor("GET", "/api/Me")).toBeNull();
  });

  it("never lists a credential-management route", () => {
    for (const entry of bearerAllowlist()) {
      expect(entry.path).not.toContain("connected-apps");
      expect(entry.path).not.toContain("auth");
      expect(entry.path).not.toContain("users");
      expect(entry.path).not.toContain("setup");
    }
  });
});
