import { type Styles, styling } from "./ansi.js";
import { clip, conversationRow, headerRow, layout, relativeTime, truncate } from "./format.js";
import type { ImageProtocol } from "./images.js";
import { type Model, visibleRows } from "./model.js";
import {
  type Block,
  imageRows,
  messageBlocks,
  type ReaderContext,
  windowBlocks
} from "./reader.js";

export type RenderOptions = {
  color?: boolean;
  now?: number;
  protocol?: ImageProtocol;
};

/**
 * Renders the whole interface as one string.
 *
 * Pure by construction — given a model it always produces the same frame — so
 * the tests assert on what a user would see rather than on internal state.
 */
export function render(model: Model, options: RenderOptions = {}): string {
  const styles = styling(options.color ?? false);
  const now = options.now ?? Date.now();
  const context: ReaderContext = {
    width: model.width,
    styles,
    now,
    protocol: options.protocol ?? "none",
    images: model.images,
    // An image taller than the window could never be shown at all, so it is
    // capped to what the terminal can actually hold.
    imageHeight: Math.max(1, Math.min(imageRows, visibleRows(model) - 2))
  };
  const body =
    model.screen === "reader" ? readerLines(model, context) : listLines(model, styles, now);
  return [
    queryLine(model, styles),
    ...body,
    statusLine(model, styles, now),
    keyLine(model, styles)
  ].join("\n");
}

function queryLine(model: Model, styles: Styles): string {
  if (model.screen === "reader") {
    return `  ${styles.bold(truncate(model.reader?.subject || "(no subject)", model.width - 2))}`;
  }
  return `${styles.accent("> ")}${model.query}`;
}

function listLines(model: Model, styles: Styles, now: number): string[] {
  const columns = layout(model.width);
  const rows = visibleRows(model);
  const lines: string[] = [styles.dim(headerRow(columns))];

  if (model.results.length === 0) {
    lines.push("", styles.dim(emptyMessage(model)));
    while (lines.length < rows + 1) lines.push("");
    return lines.slice(0, rows + 1);
  }

  const window = model.results.slice(model.offset, model.offset + rows);
  for (const [index, result] of window.entries()) {
    const rendered = conversationRow(result.conversation, columns, now);
    lines.push(model.offset + index === model.selected ? styles.inverse(rendered) : rendered);
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

function readerLines(model: Model, context: ReaderContext): string[] {
  const rows = visibleRows(model) + 1;
  const reader = model.reader;
  if (!reader) return blank(rows);
  if (reader.loading) return [context.styles.dim("  Loading conversation…"), ...blank(rows - 1)];
  if (reader.messages.length === 0) {
    return [
      context.styles.dim("  This conversation has no readable messages."),
      ...blank(rows - 1)
    ];
  }

  const blocks: Block[] = [];
  for (const message of reader.messages) blocks.push(...messageBlocks(message, context));
  return windowBlocks(blocks, reader.scroll, rows);
}

function statusLine(model: Model, styles: Styles, now: number): string {
  if (model.notice) {
    const notice = truncate(model.notice.text, model.width);
    return model.notice.kind === "error" ? styles.danger(notice) : styles.accent(notice);
  }

  const parts: string[] = [hostOf(model.origin)];
  if (model.account) parts.push(model.account);

  if (model.screen === "reader") {
    const reader = model.reader;
    if (reader) parts.push(`${reader.messages.length} message(s)`);
    parts.push(model.canWrite ? "read-write" : "read-only");
  } else {
    parts.push(`${model.results.length}/${model.conversations.length} cached`);
    parts.push(model.lastSyncAt ? `synced ${relativeTime(model.lastSyncAt, now)}` : "never synced");
  }

  if (model.syncing) parts.push("syncing…");
  if (model.deepSearching) parts.push("searching…");
  if (!model.online) parts.push("offline");
  if (model.includesServerResults && model.screen === "list") {
    parts.push("workspace results included");
  }
  if (model.invalidTerms.length > 0) {
    parts.push(`unknown filter: ${model.invalidTerms.join(" ")}`);
  }

  return styles.dim(truncate(parts.join(" · "), model.width));
}

type Hint = readonly [string, string];

/**
 * The key hints, on their own line so status information can never crowd them
 * out. They are listed in the order you would want to discover them, and a
 * narrow terminal drops the tail rather than truncating mid-word.
 */
function keyLine(model: Model, styles: Styles): string {
  const writeHints: Hint[] = [
    ["a", "archive"],
    ["s/S", "star"],
    ["r/u", "read"],
    ["d", "trash"]
  ];
  const hints: Hint[] =
    model.screen === "reader"
      ? [
          ["←/q", "back"],
          ["↑↓", "scroll"],
          ["pgup/pgdn", "page"],
          ...(model.canWrite ? writeHints : []),
          ["ctrl+c", "quit"]
        ]
      : [
          ["→", "open"],
          ["←", "clear"],
          ["↑↓", "move"],
          ["type", "filter"],
          ["ctrl+r", "search bodies"],
          ["ctrl+s", "sync"],
          ["ctrl+c", "quit"]
        ];
  return styles.dim(fitHints(hints, model.width));
}

const separator = "  ·  ";

/**
 * Fits hints into the width, dropping whole hints from the right rather than
 * truncating one mid-word.
 *
 * The last hint is pinned: it is how you leave, and a user who cannot find that
 * is stuck in a full-screen program. Room for it is reserved first and the rest
 * compete for what is left.
 */
export function fitHints(hints: ReadonlyArray<Hint>, width: number): string {
  if (hints.length === 0) return "";
  const pinned = hints[hints.length - 1] as Hint;
  const pinnedText = `${pinned[0]} ${pinned[1]}`;
  if (pinnedText.length >= width) return clip(pinnedText, width);

  let rendered = "";
  for (const [key, label] of hints.slice(0, -1)) {
    const next = rendered === "" ? `${key} ${label}` : `${rendered}${separator}${key} ${label}`;
    if (next.length + separator.length + pinnedText.length > width) break;
    rendered = next;
  }
  return rendered === "" ? pinnedText : `${rendered}${separator}${pinnedText}`;
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
