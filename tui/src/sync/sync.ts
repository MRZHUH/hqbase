import type { DatabaseSync } from "node:sqlite";

import type { Client } from "../api/client.js";
import { saveConversations, writeMeta } from "../store/cache.js";

export const lastSyncKey = "last_sync_at";

export type SyncResult = {
  added: number;
  updated: number;
  pages: number;
  /** True when the page budget ran out before the workspace ran out of pages. */
  truncated: boolean;
};

/**
 * Pulls recent conversations into the cache, newest first.
 *
 * The window is bounded on purpose: this is a search cache, not a replica of the
 * mailbox. Paging stops at `maxPages`, and the caller is told when it stopped
 * early so a partial view is never presented as a complete one.
 */
export async function syncConversations(
  db: DatabaseSync,
  client: Client,
  options: { folder?: string | undefined; maxPages?: number } = {}
): Promise<SyncResult> {
  const maxPages = options.maxPages ?? 10;
  let cursor: string | undefined;
  let added = 0;
  let updated = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page = await client.conversations({
      ...(options.folder === undefined ? {} : { folder: options.folder }),
      ...(cursor === undefined ? {} : { cursor })
    });
    const saved = saveConversations(db, page.conversations);
    added += saved.added;
    updated += saved.updated;
    pages += 1;
    if (!page.nextCursor) {
      writeMeta(db, lastSyncKey, new Date().toISOString());
      return { added, updated, pages, truncated: false };
    }
    cursor = page.nextCursor;
  }

  writeMeta(db, lastSyncKey, new Date().toISOString());
  return { added, updated, pages, truncated: true };
}

/**
 * Runs a server-side search, which reaches message bodies the cache does not
 * hold, and files whatever comes back into the cache.
 */
export async function deepSearch(
  db: DatabaseSync,
  client: Client,
  search: string
): Promise<{ found: number; added: number }> {
  const page = await client.conversations({ search });
  const saved = saveConversations(db, page.conversations);
  return { found: page.conversations.length, added: saved.added };
}
