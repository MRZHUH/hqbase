import { spawn } from "node:child_process";
import { login, requestedScopes, revoke } from "../auth/oauth.js";
import { normalizeOrigin } from "../config/paths.js";
import {
  deleteCredentials,
  readCredentials,
  readSettings,
  writeCredentials,
  writeSettings
} from "../config/store.js";

import { resolveOrigin } from "./session.js";

export async function runLogin(args: {
  origin: string | undefined;
  write: boolean;
  noBrowser: boolean;
}): Promise<void> {
  const origin = normalizeOrigin(args.origin ?? readSettings().defaultOrigin ?? "");
  const scopes = requestedScopes(args.write);

  process.stderr.write(`Authorizing ${origin} for: ${scopes.join(", ")}\n`);

  const credentials = await login({
    origin,
    write: args.write,
    onAuthorizationUrl: (url) => {
      // The URL is always printed, because a remote shell, a container, or a
      // machine with no browser must still be able to finish the flow.
      process.stderr.write(`\nOpen this URL to continue:\n\n  ${url}\n\n`);
      if (!args.noBrowser) openBrowser(url);
      process.stderr.write("Waiting for the browser to complete authorization…\n");
    }
  });

  writeCredentials(credentials);
  writeSettings({ defaultOrigin: credentials.origin });
  process.stderr.write(
    `Signed in to ${credentials.origin}. Granted: ${credentials.scopes.join(", ")}\n`
  );
}

export async function runLogout(args: { origin: string | undefined }): Promise<void> {
  const origin = resolveOrigin(args.origin);
  const credentials = readCredentials(origin);
  if (!credentials) {
    process.stderr.write(`Not signed in to ${origin}.\n`);
    return;
  }
  const revoked = await revoke(credentials);
  deleteCredentials(origin);
  process.stderr.write(
    revoked
      ? `Signed out of ${origin} and revoked the credential.\n`
      : `Signed out of ${origin}. The workspace could not be reached, so revoke the ` +
          "application under Settings › Applications when it is back.\n"
  );
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32"
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL was already printed, so a browser that will not launch is not a
    // failure of the flow.
  }
}
