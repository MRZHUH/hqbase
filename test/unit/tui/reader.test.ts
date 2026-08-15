import type { MessageAttachment, MessageDetail } from "@tui/api/types";
import { styling } from "@tui/ui/ansi";
import type { ImageProtocol } from "@tui/ui/images";
import type { ImageState } from "@tui/ui/model";
import {
  type Block,
  imageRows,
  messageBlocks,
  type ReaderContext,
  totalRows,
  windowBlocks
} from "@tui/ui/reader";
import { describe, expect, it } from "vitest";

import { now } from "./fixtures";

function context(overrides: Partial<ReaderContext> = {}): ReaderContext {
  return {
    width: 100,
    styles: styling(false),
    now,
    protocol: "none" as ImageProtocol,
    images: {},
    imageHeight: imageRows,
    ...overrides
  };
}

function attachment(overrides: Partial<MessageAttachment> & { id: string }): MessageAttachment {
  return {
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 1536,
    contentId: null,
    ...overrides
  };
}

function message(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m1",
    threadId: "thr_c1",
    mailboxId: "mbx_team",
    direction: "inbound",
    folder: "inbox",
    fromAddress: "alice@example.com",
    to: ["team@example.com"],
    cc: [],
    bcc: [],
    subject: "Quarterly review",
    snippet: "Numbers",
    receivedAt: "2026-08-15T11:00:00.000Z",
    sentAt: null,
    readAt: "2026-08-15T11:30:00.000Z",
    starredAt: null,
    hasAttachments: false,
    createdAt: "2026-08-15T11:00:00.000Z",
    textBody: "Body text.",
    htmlAvailable: false,
    attachments: [],
    ...overrides
  };
}

function text(blocks: Block[]): string {
  return blocks.map((block) => block.text).join("\n");
}

describe("message headers", () => {
  it("shows sender, recipients, and both date forms", () => {
    const rendered = text(messageBlocks(message(), context()));
    expect(rendered).toContain("From:  alice@example.com");
    expect(rendered).toContain("To:    team@example.com");
    expect(rendered).toMatch(/Date:\s+2026-08-15 \d\d:\d\d {2}\(1h ago\)/);
  });

  it("names every recipient rather than counting them", () => {
    const rendered = text(
      messageBlocks(message({ to: ["a@example.com", "b@example.com"] }), context())
    );
    expect(rendered).toContain("a@example.com, b@example.com");
  });

  it("says so when a message has no recipients", () => {
    expect(text(messageBlocks(message({ to: [] }), context()))).toContain("(nobody)");
  });

  it("marks attachments, images, an HTML part, and unread state", () => {
    const rendered = text(
      messageBlocks(
        message({
          hasAttachments: true,
          htmlAvailable: true,
          readAt: null,
          attachments: [attachment({ id: "a1", contentType: "image/png", filename: "chart.png" })]
        }),
        context()
      )
    );
    expect(rendered).toContain("has attachments");
    expect(rendered).toContain("has images");
    expect(rendered).toContain("formatted (HTML) version");
    expect(rendered).toContain("unread");
  });

  it("carries no Flags line for a plain read message", () => {
    expect(text(messageBlocks(message(), context()))).not.toContain("Flags:");
  });
});

describe("attachments", () => {
  it("lists each attachment with its type and size", () => {
    const rendered = text(
      messageBlocks(message({ attachments: [attachment({ id: "a1" })] }), context())
    );
    expect(rendered).toContain("Attachments (1)");
    expect(rendered).toContain("report.pdf — application/pdf, 1.5 KB");
  });

  it("marks an attachment the message referenced inline", () => {
    const rendered = text(
      messageBlocks(
        message({ attachments: [attachment({ id: "a1", contentId: "cid:1" })] }),
        context()
      )
    );
    expect(rendered).toContain(", inline");
  });

  it("keeps its indentation, which the row formatter would have stripped", () => {
    const rendered = text(
      messageBlocks(message({ attachments: [attachment({ id: "a1" })] }), context())
    );
    expect(rendered).toContain("  • report.pdf");
  });
});

describe("images", () => {
  const withImage = message({
    attachments: [attachment({ id: "a1", contentType: "image/png", filename: "chart.png" })]
  });

  function state(value: ImageState): ReaderContext {
    return context({ protocol: "iterm", images: { a1: value } });
  }

  it("draws the image inline when the terminal can show it", () => {
    const blocks = messageBlocks(withImage, state({ status: "ready", base64: "aGk=", bytes: 2 }));
    const drawing = blocks.find((block) => block.rows > 1);
    expect(drawing?.rows).toBe(imageRows);
    expect(drawing?.text).toContain("1337;File=inline=1");
  });

  it("shrinks the image to what a short window can hold", () => {
    const blocks = messageBlocks(withImage, {
      ...state({ status: "ready", base64: "aGk=", bytes: 2 }),
      imageHeight: 3
    });
    const drawing = blocks.find((block) => block.rows > 1);
    expect(drawing?.rows).toBe(3);
    expect(drawing?.text).toContain("height=3");
  });

  it("says the terminal cannot show it rather than leaving a gap", () => {
    const blocks = messageBlocks(
      withImage,
      context({ protocol: "none", images: { a1: { status: "ready", base64: "aGk=", bytes: 2 } } })
    );
    expect(text(blocks)).toContain("[image] this terminal cannot display images");
  });

  it("explains a format the terminal's protocol cannot carry", () => {
    const jpeg = message({
      attachments: [attachment({ id: "a1", contentType: "image/jpeg", filename: "photo.jpg" })]
    });
    const blocks = messageBlocks(
      jpeg,
      context({ protocol: "kitty", images: { a1: { status: "ready", base64: "aGk=", bytes: 2 } } })
    );
    expect(text(blocks)).toContain("cannot display this image format");
  });

  it("shows progress while the image is being fetched", () => {
    expect(text(messageBlocks(withImage, state({ status: "loading" })))).toContain(
      "[image] loading…"
    );
  });

  it("passes on the reason an image was skipped", () => {
    expect(
      text(messageBlocks(withImage, state({ status: "skipped", reason: "too large to display" })))
    ).toContain("[image] too large to display");
  });

  it("never tries to draw a non-image attachment", () => {
    const blocks = messageBlocks(
      message({ attachments: [attachment({ id: "a1" })] }),
      state({ status: "ready", base64: "aGk=", bytes: 2 })
    );
    expect(blocks.every((block) => block.rows === 1)).toBe(true);
    expect(text(blocks)).not.toContain("[image]");
  });
});

describe("windowBlocks", () => {
  const blocks: Block[] = [
    { text: "one", rows: 1 },
    { text: "picture", rows: 4 },
    { text: "two", rows: 1 },
    { text: "three", rows: 1 }
  ];

  it("counts the rows a block occupies, not the blocks", () => {
    expect(windowBlocks(blocks, 0, 5)).toEqual(["one", "picture"]);
  });

  it("pads to exactly the rows it was given", () => {
    expect(windowBlocks([{ text: "one", rows: 1 }], 0, 4)).toEqual(["one", "", "", ""]);
  });

  it("scrolls past a tall block by its rows", () => {
    expect(windowBlocks(blocks, 5, 2)).toEqual(["two", "three"]);
  });

  it("never emits more lines than the rows it was given", () => {
    for (const scroll of [0, 1, 3, 5, 20]) {
      expect(windowBlocks(blocks, scroll, 3)).toHaveLength(3);
    }
  });

  it("totals the rows of a block list", () => {
    expect(totalRows(blocks)).toBe(7);
  });
});
