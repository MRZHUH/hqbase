import type { MessageAction, MessageDetail } from "../api/types.js";
import type { SearchResult } from "../search/filter.js";
import { searchConversations } from "../search/filter.js";
import { parseQuery } from "../search/query.js";
import type { CachedConversation } from "../store/cache.js";

import type { Key } from "./keys.js";

export type Screen = "list" | "reader";

/** An entry in the action menu the list opens on enter. */
export type MenuAction = "read" | "unread" | "trash";

export type MenuItem = {
  action: MenuAction;
  label: string;
};

export const menuItems: readonly MenuItem[] = [
  { action: "read", label: "Mark as read" },
  { action: "trash", label: "Delete (move to trash)" },
  { action: "unread", label: "Mark as unread" }
];

/** An overlay awaiting a decision: per-conversation actions, or a confirmation. */
export type Overlay =
  | { kind: "actions"; conversationId: string; subject: string; selected: number }
  | { kind: "confirm-all-read"; count: number };

export type Notice = { text: string; kind: "info" | "error" } | null;

/** What the client knows about one image attachment it tried to show. */
export type ImageState =
  | { status: "loading" }
  | { status: "ready"; base64: string; bytes: number }
  | { status: "skipped"; reason: string };

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
  overlay: Overlay | null;
  /** Fetched image attachments, keyed by attachment id. */
  images: Record<string, ImageState>;
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
  | { type: "image"; attachmentId: string; state: ImageState }
  | { type: "acted"; action: MessageAction }
  | { type: "marked-all-read"; count: number }
  | { type: "notice"; text: string; kind: "info" | "error" }
  | { type: "offline"; text: string };

export type Effect =
  | { type: "sync" }
  | { type: "deep-search"; search: string }
  | { type: "open"; conversationId: string; threadId: string }
  | { type: "act"; conversationId: string; action: MessageAction; folder: string }
  | { type: "images"; attachments: Array<{ id: string; contentType: string; sizeBytes: number }> }
  | { type: "reload" }
  | { type: "mark-all-read"; conversationIds: string[]; folder: string }
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
    overlay: null,
    images: {},
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

/**
 * Rows the body can show. Four are spoken for: the query line at the top, the
 * column header, and the status and key-hint lines at the bottom.
 */
export function visibleRows(model: Model): number {
  return Math.max(model.height - 4, 1);
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
