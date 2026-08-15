import { boolFlag, numberFlag, parseArgs, stringFlag } from "@tui/args";

import { buildAuthorizationUrl, requestedScopes } from "@tui/auth/oauth";
import { createPkce, createState, stateMatches } from "@tui/auth/pkce";
import { describe, expect, it } from "vitest";

describe("PKCE", () => {
  it("produces a fresh verifier and an S256 challenge each time", () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(first.verifier);
    expect(first.method).toBe("S256");
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces a fresh state each time", () => {
    expect(createState()).not.toBe(createState());
  });

  it("accepts only the exact state it generated", () => {
    const state = createState();
    expect(stateMatches(state, state)).toBe(true);
    expect(stateMatches(state, `${state}x`)).toBe(false);
    expect(stateMatches(state, state.slice(0, -1))).toBe(false);
    expect(stateMatches(state, "")).toBe(false);
    expect(stateMatches(state, null)).toBe(false);
  });
});

describe("requestedScopes", () => {
  it("asks for read-only access by default", () => {
    expect(requestedScopes(false)).toEqual(["mail:read", "offline_access"]);
    expect(requestedScopes(false)).not.toContain("mail:write");
  });

  it("asks for write access only when the operator opts in", () => {
    expect(requestedScopes(true)).toContain("mail:write");
  });

  it("never asks for send access", () => {
    expect(requestedScopes(true)).not.toContain("mail:send");
  });
});

describe("buildAuthorizationUrl", () => {
  const url = new URL(
    buildAuthorizationUrl({
      endpoint: "https://mail.example.com/api/auth/oauth2/authorize",
      clientId: "client_test",
      redirectUri: "http://127.0.0.1:52341/callback",
      resource: "https://mail.example.com/api",
      scopes: ["mail:read", "offline_access"],
      state: "state-value",
      challenge: "challenge-value"
    })
  );

  it("requests an authorization code with PKCE", () => {
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("names the API resource so the token is bound to it", () => {
    expect(url.searchParams.get("resource")).toBe("https://mail.example.com/api");
  });

  it("carries the loopback redirect and the state", () => {
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:52341/callback");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("never carries the verifier", () => {
    const pkce = createPkce();
    const authorization = buildAuthorizationUrl({
      endpoint: "https://mail.example.com/api/auth/oauth2/authorize",
      clientId: "client_test",
      redirectUri: "http://127.0.0.1:52341/callback",
      resource: "https://mail.example.com/api",
      scopes: ["mail:read"],
      state: "state-value",
      challenge: pkce.challenge
    });
    expect(authorization).not.toContain(pkce.verifier);
  });
});

describe("parseArgs", () => {
  const valued = new Set(["origin", "limit"]);

  it("reads a value given after the flag", () => {
    const args = parseArgs(["--limit", "5"], valued);
    expect(numberFlag(args, "limit", 20)).toBe(5);
  });

  it("reads a value given with an equals sign", () => {
    expect(stringFlag(parseArgs(["--origin=https://a.example"], valued), "origin")).toBe(
      "https://a.example"
    );
  });

  it("lets flags appear after positional arguments", () => {
    const args = parseArgs(["invoice", "number", "--limit", "3"], valued);
    expect(args.positional).toEqual(["invoice", "number"]);
    expect(numberFlag(args, "limit", 20)).toBe(3);
  });

  it("treats a valueless flag as a boolean", () => {
    expect(boolFlag(parseArgs(["--write"], valued), "write")).toBe(true);
    expect(boolFlag(parseArgs([], valued), "write")).toBe(false);
  });

  it("does not swallow the next flag as a value", () => {
    const args = parseArgs(["--origin", "--write"], valued);
    expect(stringFlag(args, "origin")).toBeUndefined();
    expect(boolFlag(args, "write")).toBe(true);
  });

  it("falls back when a numeric flag is not a positive number", () => {
    expect(numberFlag(parseArgs(["--limit", "zero"], valued), "limit", 20)).toBe(20);
    expect(numberFlag(parseArgs(["--limit", "-4"], valued), "limit", 20)).toBe(20);
  });
});
