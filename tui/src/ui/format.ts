import type { CachedConversation } from "../store/cache.js";

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
export function layout(width: number): Columns {
  const usable = Math.max(width, 20);
  const flags = 4;
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

export function pad(value: string, width: number): string {
  if (width <= 0) return "";
  return truncate(value, width).padEnd(width, " ");
}

export function truncate(value: string, width: number): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  if (flattened.length <= width) return flattened;
  if (width <= 1) return flattened.slice(0, width);
  return `${flattened.slice(0, width - 1)}…`;
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (current === "") {
        current = word;
      } else if (`${current} ${word}`.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
      while (current.length > width) {
        lines.push(current.slice(0, width));
        current = current.slice(width);
      }
    }
    lines.push(current);
  }
  return lines;
}
