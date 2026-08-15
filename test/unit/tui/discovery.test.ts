import { discoverApiResource, discoverAuthorizationServer } from "@tui/auth/discovery";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://mail.example.com";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(routes: Record<string, Response>): void {
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = routes[new URL(url).pathname];
    return Promise.resolve(response ?? html());
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/** What a workspace without the route actually returns: its single-page app. */
function html(): Response {
  return new Response("<!doctype html><html><body>HQBase</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
}

describe("discoverApiResource", () => {
  it("reads the advertised resource and authorization server", async () => {
    respond({
      "/.well-known/oauth-protected-resource/api": json({
        resource: `${origin}/api`,
        authorization_servers: [`${origin}/api/auth`],
        scopes_supported: ["mail:read", "mail:write"]
      })
    });
    await expect(discoverApiResource(origin)).resolves.toEqual({
      resource: `${origin}/api`,
      authorizationServers: [`${origin}/api/auth`],
      scopesSupported: ["mail:read", "mail:write"]
    });
  });

  it("explains that a workspace without the route needs updating", async () => {
    respond({});
    await expect(discoverApiResource(origin)).rejects.toThrow(
      /does not offer terminal sign-in.*Update the workspace/s
    );
  });

  it("says the same for a workspace that answers 404", async () => {
    respond({
      "/.well-known/oauth-protected-resource/api": new Response("nope", { status: 404 })
    });
    await expect(discoverApiResource(origin)).rejects.toThrow(/does not offer terminal sign-in/);
  });

  it("never surfaces a raw JSON parse failure", async () => {
    respond({
      "/.well-known/oauth-protected-resource/api": new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });
    await expect(discoverApiResource(origin)).rejects.not.toThrow(/Unexpected token/);
  });

  it("reports a server error as itself rather than as a missing route", async () => {
    respond({
      "/.well-known/oauth-protected-resource/api": new Response("boom", { status: 500 })
    });
    await expect(discoverApiResource(origin)).rejects.toThrow(/responded 500/);
  });

  it("rejects metadata that advertises no authorization server", async () => {
    respond({
      "/.well-known/oauth-protected-resource/api": json({ resource: `${origin}/api` })
    });
    await expect(discoverApiResource(origin)).rejects.toThrow(/does not advertise an API resource/);
  });

  it("normalizes the origin before asking", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (input: string | URL) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return Promise.resolve(
        json({ resource: `${origin}/api`, authorization_servers: [`${origin}/api/auth`] })
      );
    });
    await discoverApiResource("https://mail.example.com/inbox/");
    expect(seen[0]).toBe(`${origin}/.well-known/oauth-protected-resource/api`);
  });
});

describe("discoverAuthorizationServer", () => {
  it("reads the endpoints from the issuer's metadata document", async () => {
    respond({
      "/.well-known/oauth-authorization-server/api/auth": json({
        issuer: `${origin}/api/auth`,
        authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
        token_endpoint: `${origin}/api/auth/oauth2/token`,
        registration_endpoint: `${origin}/api/auth/oauth2/register`
      })
    });
    await expect(discoverAuthorizationServer(`${origin}/api/auth`)).resolves.toMatchObject({
      authorizationEndpoint: `${origin}/api/auth/oauth2/authorize`,
      tokenEndpoint: `${origin}/api/auth/oauth2/token`,
      registrationEndpoint: `${origin}/api/auth/oauth2/register`,
      revocationEndpoint: null
    });
  });

  it("rejects metadata missing the endpoints the flow needs", async () => {
    respond({
      "/.well-known/oauth-authorization-server/api/auth": json({ issuer: `${origin}/api/auth` })
    });
    await expect(discoverAuthorizationServer(`${origin}/api/auth`)).rejects.toThrow(
      /did not advertise its endpoints/
    );
  });
});
