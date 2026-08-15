import type { CachedConversation } from "../store/cache.js";

import { fuzzyScore } from "./fuzzy.js";
import { isEmptyQuery, type Query, type QueryField } from "./query.js";

export type SearchResult = {
  conversation: CachedConversation;
  score: number;
};

/**
 * Applies a parsed query to the cached conversations.
 *
 * Structured filters are exact and cheap, so they run first and remove most rows
 * before any fuzzy scoring happens; that ordering is what keeps this fast enough
 * to run on every keystroke.
 */
export function searchConversations(
  conversations: readonly CachedConversation[],
  query: Query,
  now = Date.now()
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const conversation of conversations) {
    if (!matchesFilters(conversation, query, now)) continue;
    const score = scoreTerms(conversation, query.terms);
    if (score === null) continue;
    results.push({ conversation, score });
  }

  // Recency is the tiebreaker, and the only order at all when the query has no
  // free text: an empty query should read as an inbox, not as a ranking.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.conversation.activityAt.localeCompare(a.conversation.activityAt);
  });
  return results;
}

export function matchesFilters(
  conversation: CachedConversation,
  query: Query,
  now = Date.now()
): boolean {
  if (query.hasAttachment && !conversation.hasAttachments) return false;

  for (const state of query.states) {
    if (state === "unread" && conversation.unreadCount === 0) return false;
    if (state === "read" && conversation.unreadCount > 0) return false;
    if (state === "starred" && !conversation.isStarred) return false;
  }

  if (query.folders.length > 0) {
    const matched = query.folders.some((folder) =>
      folder === "starred" ? conversation.isStarred : conversation.folder === folder
    );
    if (!matched) return false;
  }

  for (const [field, values] of Object.entries(query.fields)) {
    const haystack = fieldValue(conversation, field as QueryField);
    if (!values.every((value) => haystack.includes(value))) return false;
  }

  const age = now - Date.parse(conversation.activityAt);
  if (Number.isFinite(age)) {
    if (query.newerThanMs !== null && age > query.newerThanMs) return false;
    if (query.olderThanMs !== null && age < query.olderThanMs) return false;
  }

  return true;
}

function scoreTerms(conversation: CachedConversation, terms: readonly string[]): number | null {
  if (terms.length === 0) return 0;
  let total = 0;
  for (const term of terms) {
    const best = bestFieldScore(conversation, term);
    if (best === null) return null;
    total += best;
  }
  return total;
}

function bestFieldScore(conversation: CachedConversation, term: string): number | null {
  const candidates = [
    { text: conversation.subject, weight: 3 },
    { text: conversation.fromAddress, weight: 2 },
    { text: conversation.snippet, weight: 1 },
    { text: conversation.to.join(" "), weight: 1 }
  ];
  let best: number | null = null;
  for (const candidate of candidates) {
    const score = fuzzyScore(candidate.text, term);
    if (score === null) continue;
    const weighted = score * candidate.weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

function fieldValue(conversation: CachedConversation, field: QueryField): string {
  switch (field) {
    case "from":
      return conversation.fromAddress.toLowerCase();
    case "to":
      return conversation.to.join(" ").toLowerCase();
    case "subject":
      return conversation.subject.toLowerCase();
    case "mailbox":
      return (conversation.mailboxId ?? "").toLowerCase();
  }
}

export { isEmptyQuery };
