import type { MessageDetail } from "../api/types.js";

import { type Styles, styling } from "./ansi.js";
import { conversationRow, headerRow, layout, relativeTime, truncate, wrap } from "./format.js";
import { type Model, visibleRows } from "./model.js";

/**
 * Renders the whole interface as one string.
 *
 * Pure by construction — given a model it always produces the same frame — so
 * the tests assert on what a user would see rather than on internal state.
 */
export function render(model: Model, options: { color?: boolean; now?: number } = {}): string {
  const styles = styling(options.color ?? false);
  const now = options.now ?? Date.now();
  const body =
    model.screen === "reader" ? readerLines(model, styles, now) : listLines(model, styles, now);
  return [queryLine(model, styles), ...body, statusLine(model, styles, now)].join("\n");
}

function queryLine(model: Model, styles: Styles): string {
  const prompt = model.screen === "reader" ? "  " : styles.accent("> ");
  const text =
    model.screen === "reader"
      ? truncate(model.reader?.subject ?? "", model.width - 2)
      : model.query;
  return `${prompt}${text}`;
}

function listLines(model: Model, styles: Styles, now: number): string[] {
  const columns = layout(model.width);
  const rows = visibleRows(model);
  const lines: string[] = [styles.dim(headerRow(columns))];

  if (model.results.length === 0) {
    lines.push("");
    lines.push(styles.dim(emptyMessage(model)));
    while (lines.length < rows + 1) lines.push("");
    return lines.slice(0, rows + 1);
  }

  const window = model.results.slice(model.offset, model.offset + rows);
  for (const [index, result] of window.entries()) {
    const rendered = conversationRow(result.conversation, columns, now);
    const isSelected = model.offset + index === model.selected;
    lines.push(isSelected ? styles.inverse(rendered) : rendered);
  }
  while (lines.length < rows + 1) lines.push("");
  return lines;
}

function emptyMessage(model: Model): string {
  if (model.conversations.length === 0) {
    return model.online
      ? "  Nothing cached yet. Press ctrl+s to sync."
      : "  Nothing cached yet, and the workspace is unreachable.";
  }
  return "  No cached conversation matches. Press ctrl+r to search message bodies.";
}

function readerLines(model: Model, styles: Styles, now: number): string[] {
  const rows = visibleRows(model);
  const reader = model.reader;
  if (!reader) return blank(rows + 1);
  if (reader.loading) return [styles.dim("  Loading conversation…"), ...blank(rows)];
  if (reader.messages.length === 0) {
    return [styles.dim("  This conversation has no readable messages."), ...blank(rows)];
  }

  const lines: string[] = [];
  for (const message of reader.messages) {
    lines.push(...messageLines(message, model.width, styles, now));
  }
  const window = lines.slice(reader.scroll, reader.scroll + rows + 1);
  return window.length >= rows + 1 ? window : [...window, ...blank(rows + 1 - window.length)];
}

function messageLines(
  message: MessageDetail,
  width: number,
  styles: Styles,
  now: number
): string[] {
  const at = message.receivedAt ?? message.sentAt ?? message.createdAt;
  const lines = [
    styles.bold(truncate(`${message.fromAddress} — ${relativeTime(at, now)}`, width)),
    styles.dim(truncate(`to ${message.to.join(", ") || "(nobody)"}`, width))
  ];
  if (message.attachments.length > 0) {
    const names = message.attachments.map((attachment) => attachment.filename).join(", ");
    lines.push(styles.dim(truncate(`attachments: ${names}`, width)));
  }
  lines.push("");
  lines.push(...wrap(bodyOf(message), Math.max(width - 2, 20)).map((line) => `  ${line}`));
  lines.push("");
  lines.push(styles.dim("─".repeat(Math.max(width, 1))));
  return lines;
}

function bodyOf(message: MessageDetail): string {
  const text = message.textBody.trim();
  if (text !== "") return text;
  return message.htmlAvailable
    ? "(This message has no plain-text part. Open it in the web app to read the formatted version.)"
    : "(This message has no body.)";
}

function statusLine(model: Model, styles: Styles, now: number): string {
  if (model.notice) {
    const notice = truncate(model.notice.text, model.width);
    return model.notice.kind === "error" ? styles.danger(notice) : styles.accent(notice);
  }

  const parts: string[] = [hostOf(model.origin)];
  if (model.account) parts.push(model.account);

  if (model.screen === "reader") {
    parts.push(model.canWrite ? "a archive · s star · u unread · d trash" : "read-only");
  } else {
    parts.push(`${model.results.length}/${model.conversations.length} cached`);
    parts.push(model.lastSyncAt ? `synced ${relativeTime(model.lastSyncAt, now)}` : "never synced");
  }

  // Anything the user needs to act on goes before the key hints, because the
  // status line is truncated to the terminal width and the hints are the part
  // that can be lost without cost.
  if (model.syncing) parts.push("syncing…");
  if (model.deepSearching) parts.push("searching…");
  if (!model.online) parts.push("offline");
  if (model.includesServerResults && model.screen === "list") {
    parts.push("workspace results included");
  }
  if (model.invalidTerms.length > 0) {
    parts.push(`unknown filter: ${model.invalidTerms.join(" ")}`);
  }

  parts.push(
    model.screen === "reader"
      ? "q back"
      : "enter open · ctrl+r deep search · ctrl+s sync · ctrl+c quit"
  );

  return styles.dim(truncate(parts.join(" · "), model.width));
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function blank(count: number): string[] {
  return Array.from({ length: Math.max(count, 0) }, () => "");
}
