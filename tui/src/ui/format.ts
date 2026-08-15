import type { CachedConversation } from "../store/cache.js";

import { displayWidth, padColumns, sliceColumns } from "./width.js";

export type Columns = {
  flags: number;
  from: number;
  subject: number;
  date: number;
};

/**
 * Divides the terminal width between the columns, dropping the sender before the
 * subject and the subject before the date. A very narrow terminal keeps the
 * subject and the flags, because those are what identify a row.
 */
/**
 * Columns available to a frame line.
 *
 * One column is always left unused. A styled line that reaches the last column
 * puts the terminal into deferred wrap, and the next newline then bleeds the
 * selected row's background onto the following line and scrolls the frame.
 */
export function usableWidth(width: number): number {
  return Math.max(width - 1, 20);
}

export function layout(width: number): Columns {
  const usable = usableWidth(width);
  // Six columns, not four: the unread dot and the star are East Asian Ambiguous
  // and are reserved two columns each, so all four markers together need six.
  const flags = 6;
  const date = usable >= 60 ? 12 : 0;
  const from = usable >= 80 ? 24 : usable >= 60 ? 18 : 0;
  const gaps = [flags, from, date].filter((size) => size > 0).length;
  const subject = Math.max(usable - flags - from - date - gaps, 8);
  return { flags, from, subject, date };
}

export function conversationRow(
  conversation: CachedConversation,
  columns: Columns,
  now = Date.now()
): string {
  const cells = [pad(flags(conversation), columns.flags)];
  if (columns.from > 0) cells.push(pad(sender(conversation.fromAddress), columns.from));
  cells.push(pad(subjectOf(conversation), columns.subject));
  if (columns.date > 0) cells.push(pad(relativeTime(conversation.activityAt, now), columns.date));
  return cells.join(" ");
}

export function headerRow(columns: Columns): string {
  const cells = [pad("", columns.flags)];
  if (columns.from > 0) cells.push(pad("FROM", columns.from));
  cells.push(pad("SUBJECT", columns.subject));
  if (columns.date > 0) cells.push(pad("DATE", columns.date));
  return cells.join(" ");
}

export function flags(conversation: CachedConversation): string {
  return [
    conversation.unreadCount > 0 ? "●" : " ",
    conversation.isStarred ? "★" : " ",
    conversation.hasAttachments ? "@" : " ",
    conversation.messageCount > 1 ? "+" : " "
  ].join("");
}

export function subjectOf(conversation: CachedConversation): string {
  const subject = conversation.subject.trim() || "(no subject)";
  const count = conversation.messageCount > 1 ? ` (${conversation.messageCount})` : "";
  return `${subject}${count}`;
}

/** Prefers the display name inside `Name <addr>`, falling back to the address. */
export function sender(address: string): string {
  const named = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(address);
  const value = named?.[1]?.trim() || named?.[2]?.trim() || address.trim();
  return value === "" ? "(unknown)" : value;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(Math.round((now - at) / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/** An absolute local timestamp, for the reader where precision matters. */
export function absoluteTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown date";
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function pad(value: string, width: number): string {
  if (width <= 0) return "";
  return padColumns(truncate(value, width), width);
}

/**
 * Clips to the width without touching the text otherwise.
 *
 * `truncate` collapses whitespace, which is what a one-line table cell wants and
 * exactly what the reader must not have: it would eat header alignment and the
 * indentation of an attachment list.
 */
export function clip(value: string, width: number): string {
  if (displayWidth(value) <= width) return value;
  if (width <= 1) return sliceColumns(value, Math.max(width, 0));
  // The ellipsis is East Asian Ambiguous, so it is counted as two columns and
  // the text is cut to leave room for it.
  return `${sliceColumns(value, width - 2)}…`;
}

export function truncate(value: string, width: number): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return clip(flattened, width);
}

/** Wraps on display columns, so a line of ideographs still fits the terminal. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (displayWidth(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      current = word;
      // A single word wider than the line, such as a run of ideographs or a
      // long URL, is broken on column boundaries rather than left to overflow.
      while (displayWidth(current) > width) {
        const head = sliceColumns(current, width);
        lines.push(head);
        current = current.slice(head.length);
      }
    }
    lines.push(current);
  }
  return lines;
}
