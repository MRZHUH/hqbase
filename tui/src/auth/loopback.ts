import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { stateMatches } from "./pkce.js";

export type Redirect = {
  code: string;
};

export type Listener = {
  redirectUri: string;
  /** Resolves with the authorization code, or rejects on denial or timeout. */
  waitForRedirect(): Promise<Redirect>;
  close(): void;
};

/**
 * Listens on an ephemeral loopback port for the browser redirect that ends the
 * authorization flow. Binding to 127.0.0.1 rather than 0.0.0.0 keeps the
 * one-time code off the local network.
 */
export async function listenForRedirect(options: {
  state: string;
  path?: string;
  timeoutMs?: number;
}): Promise<Listener> {
  const path = options.path ?? "/callback";
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  let settle: ((redirect: Redirect) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const result = new Promise<Redirect>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // The listener can fail before the caller gets around to awaiting it — a
  // stray request on the port, or the timeout firing during setup. Marking the
  // promise handled here keeps that from surfacing as an unhandled rejection
  // that would take the process down; the caller still sees the rejection.
  result.catch(() => undefined);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== path) {
      respond(response, 404, "Not found.");
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      respond(response, 400, "Authorization was declined. You can close this page.");
      fail?.(new Error(describe(error, url.searchParams.get("error_description"))));
      return;
    }

    if (!stateMatches(options.state, url.searchParams.get("state"))) {
      respond(response, 400, "This authorization response did not come from this sign-in.");
      fail?.(new Error("The authorization response did not match this sign-in attempt."));
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      respond(response, 400, "The authorization response carried no code.");
      fail?.(new Error("The authorization response carried no code."));
      return;
    }

    respond(response, 200, "Signed in. You can close this page and return to your terminal.");
    settle?.({ code });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const timer = setTimeout(() => {
    fail?.(new Error("Timed out waiting for the browser to complete authorization."));
  }, timeoutMs);
  timer.unref();

  return {
    redirectUri: `http://127.0.0.1:${port(server)}${path}`,
    waitForRedirect: () => result,
    close: () => {
      clearTimeout(timer);
      server.close();
    }
  };
}

function port(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The loopback listener did not bind to a port.");
  }
  return (address as AddressInfo).port;
}

function describe(error: string, description: string | null): string {
  if (error === "access_denied") return "Authorization was declined in the browser.";
  return description ? `${error}: ${description}` : `Authorization failed: ${error}.`;
}

function respond(response: ServerResponse, status: number, message: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>HQBase</title>
<body style="font:16px system-ui;padding:3rem;max-width:32rem;margin:auto">${message}</body>`;
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}
