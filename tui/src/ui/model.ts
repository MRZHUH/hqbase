import type { MessageAction, MessageDetail } from "../api/types.js";
import type { SearchResult } from "../search/filter.js";
import { searchConversations } from "../search/filter.js";
import { parseQuery } from "../search/query.js";
import type { CachedConversation } from "../store/cache.js";

import type { Key } from "./keys.js";

export type Screen = "list" | "reader";

export type Notice = { text: string; kind: "info" | "error" } | null;

export type Reader = {
  conversationId: string;
  threadId: string;
  subject: string;
  messages: MessageDetail[];
  scroll: number;
  loading: boolean;
};

export type Model = {
  origin: string;
  account: string | null;
  version: string;
  width: number;
  height: number;
  query: string;
  cursor: number;
  conversations: CachedConversation[];
  results: SearchResult[];
  invalidTerms: string[];
  selected: number;
  offset: number;
  screen: Screen;
  reader: Reader | null;
  syncing: boolean;
  deepSearching: boolean;
  includesServerResults: boolean;
  lastSyncAt: string | null;
  online: boolean;
  canWrite: boolean;
  notice: Notice;
  quitting: boolean;
};

export type Event =
  | { type: "key"; key: Key }
  | { type: "resize"; width: number; height: number }
  | { type: "conversations"; rows: CachedConversation[]; lastSyncAt: string | null }
  | { type: "identity"; account: string }
  | { type: "sync-started" }
  | { type: "sync-finished"; added: number; updated: number; truncated: boolean }
  | { type: "deep-search-started" }
  | { type: "deep-search-finished"; found: number }
  | { type: "thread"; conversationId: string; messages: MessageDetail[] }
  | { type: "acted"; action: MessageAction }
  | { type: "notice"; text: string; kind: "info" | "error" }
  | { type: "offline"; text: string };

export type Effect =
  | { type: "sync" }
  | { type: "deep-search"; search: string }
  | { type: "open"; conversationId: string; threadId: string }
  | { type: "act"; conversationId: string; action: MessageAction; folder: string }
  | { type: "reload" }
  | { type: "quit" };

export type Options = {
  origin: string;
  version: string;
  width: number;
  height: number;
  canWrite: boolean;
  lastSyncAt: string | null;
};

export function initialModel(options: Options): Model {
  return {
    origin: options.origin,
    account: null,
    version: options.version,
    width: options.width,
    height: options.height,
    query: "",
    cursor: 0,
    conversations: [],
    results: [],
    invalidTerms: [],
    selected: 0,
    offset: 0,
    screen: "list",
    reader: null,
    syncing: false,
    deepSearching: false,
    includesServerResults: false,
    lastSyncAt: options.lastSyncAt,
    online: true,
    canWrite: options.canWrite,
    notice: null,
    quitting: false
  };
}

/** Rows the list can show, leaving room for the query line, header, and status. */
export function visibleRows(model: Model): number {
  return Math.max(model.height - 3, 1);
}

export function selectedConversation(model: Model): CachedConversation | null {
  return model.results[model.selected]?.conversation ?? null;
}

/**
 * Recomputes the visible results from the query and cache. Called on every
 * keystroke, which is why it works on an in-memory array rather than the
 * database.
 */
export function refresh(model: Model, now = Date.now()): Model {
  const query = parseQuery(model.query);
  const results = searchConversations(model.conversations, query, now);
  const selected = Math.min(model.selected, Math.max(results.length - 1, 0));
  return {
    ...model,
    results,
    invalidTerms: query.invalid,
    selected,
    offset: clampOffset(selected, model.offset, visibleRows(model), results.length)
  };
}

export function moveSelection(model: Model, delta: number): Model {
  if (model.results.length === 0) return model;
  const selected = clamp(model.selected + delta, 0, model.results.length - 1);
  return {
    ...model,
    selected,
    offset: clampOffset(selected, model.offset, visibleRows(model), model.results.length)
  };
}

export function clampOffset(selected: number, offset: number, rows: number, total: number): number {
  if (total <= rows) return 0;
  const maximum = Math.max(total - rows, 0);
  let next = Math.min(offset, maximum);
  if (selected < next) next = selected;
  if (selected >= next + rows) next = selected - rows + 1;
  return clamp(next, 0, maximum);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function withNotice(model: Model, text: string, kind: "info" | "error"): Model {
  return { ...model, notice: { text, kind } };
}
