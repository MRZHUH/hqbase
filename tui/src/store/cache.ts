import type { DatabaseSync } from "node:sqlite";

import type { ConversationSummary, MessageDetail } from "../api/types.js";

export type CachedConversation = ConversationSummary & { activityAt: string };

type Row = {
  id: string;
  thread_id: string;
  mailbox_id: string | null;
  direction: string;
  folder: string;
  from_address: string;
  to_json: string;
  subject: string;
  snippet: string;
  received_at: string | null;
  sent_at: string | null;
  read_at: string | null;
  starred_at: string | null;
  has_attachments: number;
  is_starred: number;
  message_count: number;
  unread_count: number;
  activity_at: string;
};

export function activityOf(conversation: ConversationSummary): string {
  return conversation.receivedAt ?? conversation.sentAt ?? conversation.createdAt;
}

export function saveConversations(
  db: DatabaseSync,
  conversations: readonly ConversationSummary[],
  now = new Date()
): { added: number; updated: number } {
  const existing = db.prepare("SELECT id FROM conversations WHERE id = ?");
  const upsert = db.prepare(
    `INSERT INTO conversations (
       id, thread_id, mailbox_id, direction, folder, from_address, to_json, subject, snippet,
       received_at, sent_at, read_at, starred_at, has_attachments, is_starred,
       message_count, unread_count, activity_at, cached_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       thread_id = excluded.thread_id, mailbox_id = excluded.mailbox_id,
       direction = excluded.direction, folder = excluded.folder,
       from_address = excluded.from_address, to_json = excluded.to_json,
       subject = excluded.subject, snippet = excluded.snippet,
       received_at = excluded.received_at, sent_at = excluded.sent_at,
       read_at = excluded.read_at, starred_at = excluded.starred_at,
       has_attachments = excluded.has_attachments, is_starred = excluded.is_starred,
       message_count = excluded.message_count, unread_count = excluded.unread_count,
       activity_at = excluded.activity_at, cached_at = excluded.cached_at`
  );

  let added = 0;
  let updated = 0;
  const cachedAt = now.toISOString();
  for (const conversation of conversations) {
    const seen = existing.get(conversation.id) !== undefined;
    upsert.run(
      conversation.id,
      conversation.threadId,
      conversation.mailboxId,
      conversation.direction,
      conversation.folder,
      conversation.fromAddress,
      JSON.stringify(conversation.to),
      conversation.subject,
      conversation.snippet,
      conversation.receivedAt,
      conversation.sentAt,
      conversation.readAt,
      conversation.starredAt,
      conversation.hasAttachments ? 1 : 0,
      conversation.isStarred ? 1 : 0,
      conversation.messageCount,
      conversation.unreadCount,
      activityOf(conversation),
      cachedAt
    );
    if (seen) updated += 1;
    else added += 1;
  }
  return { added, updated };
}

export function loadConversations(db: DatabaseSync, limit = 5000): CachedConversation[] {
  const rows = db
    .prepare(`SELECT * FROM conversations ORDER BY activity_at DESC, id DESC LIMIT ?`)
    .all(limit) as unknown as Row[];
  return rows.map(toConversation);
}

export function countConversations(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as unknown as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

/**
 * Records a local state change so the list stays truthful between syncs. Applied
 * only after the workspace confirms the same change.
 */
export function applyLocalAction(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<CachedConversation, "readAt" | "starredAt" | "isStarred" | "folder">>
): void {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.readAt !== undefined) {
    assignments.push("read_at = ?", "unread_count = ?");
    values.push(patch.readAt, patch.readAt === null ? 1 : 0);
  }
  if (patch.starredAt !== undefined) {
    assignments.push("starred_at = ?", "is_starred = ?");
    values.push(patch.starredAt, patch.starredAt === null ? 0 : 1);
  }
  if (patch.folder !== undefined) {
    assignments.push("folder = ?");
    values.push(patch.folder);
  }
  if (assignments.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE conversations SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
}

export function removeConversation(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function saveThread(
  db: DatabaseSync,
  threadId: string,
  messages: readonly MessageDetail[],
  now = new Date()
): void {
  const upsert = db.prepare(
    `INSERT INTO bodies (message_id, thread_id, payload, cached_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       thread_id = excluded.thread_id, payload = excluded.payload, cached_at = excluded.cached_at`
  );
  for (const message of messages) {
    upsert.run(message.id, threadId, JSON.stringify(message), now.toISOString());
  }
}

export function loadThread(db: DatabaseSync, threadId: string): MessageDetail[] {
  const rows = db
    .prepare("SELECT payload FROM bodies WHERE thread_id = ?")
    .all(threadId) as unknown as Array<{ payload: string }>;
  return rows
    .map((row) => JSON.parse(row.payload) as MessageDetail)
    .sort((a, b) => order(a).localeCompare(order(b)));
}

export function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as unknown as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function order(message: MessageDetail): string {
  return message.receivedAt ?? message.sentAt ?? message.createdAt;
}

function toConversation(row: Row): CachedConversation {
  return {
    id: row.id,
    threadId: row.thread_id,
    mailboxId: row.mailbox_id,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    folder: row.folder,
    fromAddress: row.from_address,
    to: parseList(row.to_json),
    subject: row.subject,
    snippet: row.snippet,
    receivedAt: row.received_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
    starredAt: row.starred_at,
    hasAttachments: row.has_attachments === 1,
    isStarred: row.is_starred === 1,
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    createdAt: row.activity_at,
    activityAt: row.activity_at
  };
}

function parseList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
