import { searchConversations } from "../search/filter.js";
import { parseQuery } from "../search/query.js";
import { countConversations, loadConversations, readMeta } from "../store/cache.js";
import { cacheLocation, eraseCache } from "../store/db.js";
import { lastSyncKey, syncConversations } from "../sync/sync.js";
import { conversationRow, headerRow, layout, relativeTime } from "../ui/format.js";

import { openSession, resolveOrigin } from "./session.js";

export async function runSync(args: {
  origin: string | undefined;
  folder: string | undefined;
}): Promise<void> {
  const session = openSession(args.origin);
  try {
    process.stderr.write(`Syncing ${session.origin}…\n`);
    const result = await syncConversations(session.db, session.client, {
      folder: args.folder
    });
    process.stderr.write(
      `${result.added} added, ${result.updated} updated, ${result.pages} page(s).\n`
    );
    if (result.truncated) {
      process.stderr.write("More conversations remain; run sync again to continue.\n");
    }
  } finally {
    session.close();
  }
}

export function runSearch(args: {
  origin: string | undefined;
  query: string;
  limit: number;
}): void {
  const session = openSession(args.origin);
  try {
    const conversations = loadConversations(session.db);
    const results = searchConversations(conversations, parseQuery(args.query)).slice(0, args.limit);
    const columns = layout(process.stdout.columns ?? 100);
    process.stdout.write(`${headerRow(columns)}\n`);
    for (const result of results) {
      process.stdout.write(`${conversationRow(result.conversation, columns)}\n`);
    }
    process.stderr.write(
      `\n${results.length}/${conversations.length} cached conversations. ` +
        "Message bodies are not cached; open the interface and press ctrl+r to search them.\n"
    );
  } finally {
    session.close();
  }
}

export async function runStatus(args: { origin: string | undefined }): Promise<void> {
  const session = openSession(args.origin);
  try {
    const cached = countConversations(session.db);
    const syncedAt = readMeta(session.db, lastSyncKey);
    let account = "unknown (workspace unreachable)";
    try {
      account = (await session.client.identity()).email;
    } catch {
      // Status must work offline; the cache lines below are the point of it.
    }
    process.stdout.write(
      [
        `workspace   ${session.origin}`,
        `account     ${account}`,
        `scopes      ${session.credentials.scopes.join(", ") || "none"}`,
        `cache       ${cacheLocation(session.origin)}`,
        `cached      ${cached} conversation(s)`,
        `last sync   ${syncedAt ? `${relativeTime(syncedAt)} (${syncedAt})` : "never"}`,
        ""
      ].join("\n")
    );
  } finally {
    session.close();
  }
}

export function runCacheClear(args: { origin: string | undefined }): void {
  const origin = resolveOrigin(args.origin);
  eraseCache(origin);
  process.stderr.write(
    `Removed the cached conversations and message bodies for ${origin}.\n` +
      "The workspace connection is untouched.\n"
  );
}
