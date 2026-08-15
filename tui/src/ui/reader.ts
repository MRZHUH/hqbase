import type { MessageAttachment, MessageDetail } from "../api/types.js";

import type { Styles } from "./ansi.js";
import { absoluteTime, clip, formatBytes, relativeTime, wrap } from "./format.js";
import { drawImage, type ImageProtocol, isDrawableImage } from "./images.js";
import type { ImageState } from "./model.js";

/**
 * One rendered unit of the reader. `rows` is how many terminal rows it occupies
 * once written, which is not always one: an inline image expands to the height
 * the protocol was asked for, and the window has to account for that or the
 * frame overruns the screen.
 */
export type Block = {
  text: string;
  rows: number;
};

export const imageRows = 10;

export type ReaderContext = {
  width: number;
  styles: Styles;
  now: number;
  protocol: ImageProtocol;
  images: Record<string, ImageState>;
  /** Rows an inline image may occupy, capped to what the window can hold. */
  imageHeight: number;
};

export function messageBlocks(message: MessageDetail, context: ReaderContext): Block[] {
  const blocks: Block[] = headerBlocks(message, context);
  blocks.push(line(""));

  for (const text of wrap(bodyOf(message), Math.max(context.width - 2, 20))) {
    blocks.push(line(`  ${text}`));
  }

  blocks.push(...attachmentBlocks(message, context));
  blocks.push(line(""));
  blocks.push(line(context.styles.dim("─".repeat(Math.max(context.width, 1)))));
  return blocks;
}

function headerBlocks(message: MessageDetail, context: ReaderContext): Block[] {
  const { styles, width } = context;
  const at = message.receivedAt ?? message.sentAt ?? message.createdAt;
  const blocks: Block[] = [
    field("From", message.fromAddress, styles, width, true),
    field("To", message.to.join(", ") || "(nobody)", styles, width)
  ];
  // Cc and Bcc lines appear only when the message carries them, so an ordinary
  // two-party message is not padded with empty rows.
  if (message.cc.length > 0) blocks.push(field("Cc", message.cc.join(", "), styles, width));
  if (message.bcc.length > 0) blocks.push(field("Bcc", message.bcc.join(", "), styles, width));
  blocks.push(
    field("Date", `${absoluteTime(at)}  (${relativeTime(at, context.now)})`, styles, width)
  );

  const marks = [
    message.hasAttachments || message.attachments.length > 0 ? "has attachments" : null,
    message.attachments.some((attachment) => isDrawableImage(attachment.contentType))
      ? "has images"
      : null,
    message.htmlAvailable ? "formatted (HTML) version available in the web app" : null,
    message.readAt === null ? "unread" : null
  ].filter((mark): mark is string => mark !== null);
  if (marks.length > 0) blocks.push(field("Flags", marks.join(" · "), styles, width));

  return blocks;
}

function attachmentBlocks(message: MessageDetail, context: ReaderContext): Block[] {
  if (message.attachments.length === 0) return [];
  const blocks: Block[] = [line("")];
  blocks.push(
    line(context.styles.bold(clip(`Attachments (${message.attachments.length})`, context.width)))
  );
  for (const attachment of message.attachments) {
    blocks.push(...attachmentBlock(attachment, context));
  }
  return blocks;
}

function attachmentBlock(attachment: MessageAttachment, context: ReaderContext): Block[] {
  const { styles, width } = context;
  const inline = attachment.contentId ? ", inline" : "";
  const label = `  • ${attachment.filename} — ${attachment.contentType}, ${formatBytes(
    attachment.sizeBytes
  )}${inline}`;
  const blocks: Block[] = [line(styles.dim(clip(label, width)))];

  if (!isDrawableImage(attachment.contentType)) return blocks;

  const state = context.images[attachment.id];
  if (!state || state.status === "loading") {
    blocks.push(line(styles.dim("    [image] loading…")));
    return blocks;
  }
  if (state.status === "ready") {
    const drawing = drawImage(
      context.protocol,
      { base64: state.base64, bytes: state.bytes, contentType: attachment.contentType },
      context.imageHeight
    );
    if (drawing) {
      blocks.push({ text: drawing.escape, rows: drawing.rows });
      return blocks;
    }
    // The bytes are in hand but this terminal cannot draw them, which is worth
    // saying plainly rather than leaving a gap where a picture should be.
    blocks.push(line(styles.dim(`    [image] ${describeUndrawable(context.protocol)}`)));
    return blocks;
  }
  blocks.push(line(styles.dim(`    [image] ${state.reason}`)));
  return blocks;
}

function describeUndrawable(protocol: ImageProtocol): string {
  return protocol === "none"
    ? "this terminal cannot display images"
    : "this terminal cannot display this image format";
}

function field(name: string, value: string, styles: Styles, width: number, strong = false): Block {
  const label = `${name}:`.padEnd(7, " ");
  const text = clip(`${label}${value}`, width);
  return line(strong ? styles.bold(text) : text);
}

export function bodyOf(message: MessageDetail): string {
  const text = message.textBody.trim();
  if (text !== "") return text;
  return message.htmlAvailable
    ? "(This message has no plain-text part. Open it in the web app to read the formatted version.)"
    : "(This message has no body.)";
}

function line(text: string): Block {
  return { text, rows: 1 };
}

/** Windows blocks by the rows they occupy rather than by their count. */
export function windowBlocks(blocks: readonly Block[], scroll: number, rows: number): string[] {
  const lines: string[] = [];
  let consumed = 0;
  let skipped = 0;

  for (const block of blocks) {
    if (skipped < scroll) {
      skipped += block.rows;
      continue;
    }
    if (consumed + block.rows > rows) break;
    lines.push(block.text);
    consumed += block.rows;
  }
  while (consumed < rows) {
    lines.push("");
    consumed += 1;
  }
  return lines;
}

export function totalRows(blocks: readonly Block[]): number {
  return blocks.reduce((sum, block) => sum + block.rows, 0);
}
