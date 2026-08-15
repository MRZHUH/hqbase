import { listenForRedirect } from "@tui/auth/loopback";
import { createState } from "@tui/auth/pkce";
import { describe, expect, it } from "vitest";

describe("listenForRedirect", () => {
  it("binds an ephemeral loopback port and reports its own redirect URI", async () => {
    const listener = await listenForRedirect({ state: createState() });
    try {
      const url = new URL(listener.redirectUri);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/callback");
      expect(Number.parseInt(url.port, 10)).toBeGreaterThan(0);
    } finally {
      listener.close();
    }
  });

  it("never binds the same port twice at once", async () => {
    const first = await listenForRedirect({ state: createState() });
    const second = await listenForRedirect({ state: createState() });
    try {
      expect(first.redirectUri).not.toBe(second.redirectUri);
    } finally {
      first.close();
      second.close();
    }
  });

  it("resolves with the code the browser redirected back", async () => {
    const state = createState();
    const listener = await listenForRedirect({ state });
    try {
      const pending = listener.waitForRedirect();
      const response = await fetch(
        `${listener.redirectUri}?code=auth-code-value&state=${encodeURIComponent(state)}`
      );
      expect(response.status).toBe(200);
      await expect(pending).resolves.toEqual({ code: "auth-code-value" });
    } finally {
      listener.close();
    }
  });

  it("rejects a redirect whose state does not match this attempt", async () => {
    const listener = await listenForRedirect({ state: createState() });
    try {
      const pending = listener.waitForRedirect();
      const response = await fetch(`${listener.redirectUri}?code=stolen&state=someone-elses`);
      expect(response.status).toBe(400);
      await expect(pending).rejects.toThrow(/did not match/i);
    } finally {
      listener.close();
    }
  });

  it("rejects a redirect carrying no state at all", async () => {
    const listener = await listenForRedirect({ state: createState() });
    try {
      const pending = listener.waitForRedirect();
      await fetch(`${listener.redirectUri}?code=stolen`);
      await expect(pending).rejects.toThrow(/did not match/i);
    } finally {
      listener.close();
    }
  });

  it("reports a declined authorization", async () => {
    const state = createState();
    const listener = await listenForRedirect({ state });
    try {
      const pending = listener.waitForRedirect();
      await fetch(`${listener.redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`);
      await expect(pending).rejects.toThrow(/declined/i);
    } finally {
      listener.close();
    }
  });

  it("reports a response that carried no code", async () => {
    const state = createState();
    const listener = await listenForRedirect({ state });
    try {
      const pending = listener.waitForRedirect();
      await fetch(`${listener.redirectUri}?state=${encodeURIComponent(state)}`);
      await expect(pending).rejects.toThrow(/no code/i);
    } finally {
      listener.close();
    }
  });

  it("ignores a request to any other path", async () => {
    const listener = await listenForRedirect({ state: createState() });
    try {
      const url = new URL(listener.redirectUri);
      const response = await fetch(`${url.origin}/somewhere-else`);
      expect(response.status).toBe(404);
    } finally {
      listener.close();
    }
  });

  it("gives up after the login timeout", async () => {
    const listener = await listenForRedirect({ state: createState(), timeoutMs: 10 });
    try {
      await expect(listener.waitForRedirect()).rejects.toThrow(/timed out/i);
    } finally {
      listener.close();
    }
  });

  it("never echoes the code back into the page it serves", async () => {
    const state = createState();
    const listener = await listenForRedirect({ state });
    try {
      const pending = listener.waitForRedirect();
      const response = await fetch(
        `${listener.redirectUri}?code=super-secret-code&state=${encodeURIComponent(state)}`
      );
      expect(await response.text()).not.toContain("super-secret-code");
      await pending;
    } finally {
      listener.close();
    }
  });
});
