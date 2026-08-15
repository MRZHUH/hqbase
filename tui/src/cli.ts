#!/usr/bin/env node
import { boolFlag, numberFlag, parseArgs, stringFlag } from "./args.js";
import { runCacheClear, runSearch, runStatus, runSync } from "./commands/data.js";
import { runLogin, runLogout } from "./commands/login.js";
import { openSession } from "./commands/session.js";
import { run } from "./ui/app.js";

export const version = "1.0.1";

const valuedFlags = new Set(["origin", "folder", "limit"]);

const usage = `usage: hqbase-mail [command] [flags]

With no command hqbase-mail opens the interactive mail browser.

  ui                                  open the browser explicitly
  login [origin] [--write]            authorize this machine in your browser
  logout                              revoke and forget this workspace
  search <query> [--limit N]          search the local cache and print rows
  sync [--folder F]                   pull recent conversations into the cache
  status                              show the connection and the cache
  cache clear                         delete the cached mail for this workspace
  version                             print the version

Every command takes --origin <url> to target a workspace other than the
one login remembered.

The query line accepts free text plus these filters, ANDed together:

  from:alice  to:team  subject:invoice  mailbox:mbx_1
  is:unread   is:read  is:starred       has:attachment
  in:inbox    in:sent  in:archived      in:trash  in:catchall
  newer:7d    older:2w                  (units: d, w, m)

Free text matches the subject, sender, and snippet of cached conversations.
Message bodies are searched by the workspace: press ctrl+r in the interface.
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(usage);
    return 0;
  }
  if (command === "-v" || command === "--version" || command === "version") {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const args = parseArgs(
    command === undefined || command.startsWith("--") ? argv : rest,
    valuedFlags
  );
  const origin = stringFlag(args, "origin");

  switch (command) {
    case undefined:
    case "ui":
      await openInterface(origin);
      return 0;
    case "login":
      await runLogin({
        origin: args.positional[0] ?? origin,
        write: boolFlag(args, "write"),
        noBrowser: boolFlag(args, "no-browser")
      });
      return 0;
    case "logout":
      await runLogout({ origin });
      return 0;
    case "search":
      runSearch({ origin, query: args.positional.join(" "), limit: numberFlag(args, "limit", 20) });
      return 0;
    case "sync":
      await runSync({ origin, folder: stringFlag(args, "folder") });
      return 0;
    case "status":
      await runStatus({ origin });
      return 0;
    case "cache":
      if (args.positional[0] !== "clear") {
        process.stderr.write("usage: hqbase-mail cache clear\n");
        return 1;
      }
      runCacheClear({ origin });
      return 0;
    default:
      if (command.startsWith("--")) {
        await openInterface(origin);
        return 0;
      }
      process.stderr.write(`${usage}\nUnknown command "${command}".\n`);
      return 1;
  }
}

async function openInterface(origin: string | undefined): Promise<void> {
  const session = openSession(origin);
  try {
    await run({ db: session.db, client: session.client, version });
  } finally {
    session.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith("cli.js");
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `hqbase-mail: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
