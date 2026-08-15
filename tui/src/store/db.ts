import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { cachePath } from "../config/paths.js";

const schema = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  mailbox_id TEXT,
  direction TEXT NOT NULL,
  folder TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  received_at TEXT,
  sent_at TEXT,
  read_at TEXT,
  starred_at TEXT,
  has_attachments INTEGER NOT NULL,
  is_starred INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  unread_count INTEGER NOT NULL,
  activity_at TEXT NOT NULL,
  cached_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_activity ON conversations(activity_at DESC);

CREATE TABLE IF NOT EXISTS bodies (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  cached_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bodies_thread ON bodies(thread_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Opens the cache for one workspace.
 *
 * The file holds mail, so it is created owner-only inside an owner-only
 * directory before SQLite writes anything into it — creating it wide and
 * narrowing afterwards would leave a window where another local account could
 * read it.
 */
export function openCache(origin: string): DatabaseSync {
  const target = cachePath(origin);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  if (!fs.existsSync(target)) fs.closeSync(fs.openSync(target, "w", 0o600));
  fs.chmodSync(target, 0o600);

  const db = new DatabaseSync(target);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(schema);
  return db;
}

export function cacheLocation(origin: string): string {
  return cachePath(origin);
}

/** Removes the cache and its SQLite sidecar files, leaving credentials alone. */
export function eraseCache(origin: string): void {
  const target = cachePath(origin);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${target}${suffix}`, { force: true });
  }
}
