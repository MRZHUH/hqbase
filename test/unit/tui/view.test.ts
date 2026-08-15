import type { MessageDetail } from "@tui/api/types";
import { initialModel, type Model, refresh } from "@tui/ui/model";
import { update } from "@tui/ui/update";
import { render } from "@tui/ui/view";
import { displayWidth } from "@tui/ui/width";
import { describe, expect, it } from "vitest";

import { now, sample } from "./fixtures";

function model(overrides: Partial<Model> = {}): Model {
  const base = initialModel({
    origin: "https://mail.example.com",
    version: "test",
    width: 100,
    height: 16,
    canWrite: true,
    lastSyncAt: "2026-08-15T11:55:00.000Z"
  });
  return refresh({ ...base, conversations: sample, ...overrides }, now);
}

function frame(state: Model): string {
  return render(state, { now });
}

function status(state: Model): string {
  return frame(state).split("\n").at(-2) ?? "";
}

function keys(state: Model): string {
  return frame(state).split("\n").at(-1) ?? "";
}

describe("render", () => {
  it("puts the query first, then status, then the key hints", () => {
    const lines = frame(model({ query: "invoice" })).split("\n");
    expect(lines[0]).toContain("invoice");
    expect(lines.at(-2)).toContain("mail.example.com");
    expect(lines.at(-1)).toContain("read");
  });

  it("always paints exactly as many lines as the terminal is tall", () => {
    for (const height of [8, 16, 40]) {
      expect(frame(model({ height })).split("\n")).toHaveLength(height);
    }
  });

  it("never emits escape sequences unless colour was asked for", () => {
    const ESC = "\u001b";
    expect(frame(model())).not.toContain(ESC);
    expect(render(model(), { now, color: true })).toContain(ESC);
  });

  it("lists the matching conversations", () => {
    const painted = frame(model());
    expect(painted).toContain("Quarterly review");
    expect(painted).toContain("Invoice 4471");
  });

  it("reports the counts and the cache age", () => {
    expect(status(model())).toContain("3/3 cached");
    expect(status(model())).toContain("synced 5m ago");
  });

  it("says the cache is empty rather than showing a blank list", () => {
    expect(frame(model({ conversations: [] }))).toContain("Nothing cached yet");
  });

  it("points at deep search when nothing cached matches", () => {
    expect(frame(model({ query: "zzzz" }))).toContain("ctrl+r");
  });

  it("names an unparsable filter in the status line", () => {
    expect(frame(model({ query: "bogus:x" }))).toContain("unknown filter: bogus:x");
  });

  it("shows the notice instead of the status when one is set", () => {
    const [next] = update(
      model(),
      { type: "sync-finished", added: 2, updated: 0, truncated: false },
      now
    );
    expect(status(next)).toContain("2 new");
  });

  it("says the workspace is unreachable", () => {
    const [next] = update(model(), { type: "offline", text: "Workspace unreachable." }, now);
    expect(frame(next)).toContain("Workspace unreachable.");
  });

  it("renders a thread with full headers and the body", () => {
    const opened = openReader(model(), [
      message({
        id: "m1",
        textBody: "First message body.",
        cc: ["manager@example.com"],
        bcc: ["audit@example.com"]
      })
    ]);
    const painted = frame(opened);
    expect(painted).toContain("From:  alice@example.com");
    expect(painted).toContain("To:    team@example.com");
    expect(painted).toContain("Cc:    manager@example.com");
    expect(painted).toContain("Bcc:   audit@example.com");
    expect(painted).toContain("Date:  ");
    expect(painted).toContain("First message body.");
  });

  it("omits Cc and Bcc when the message carries none", () => {
    const painted = frame(openReader(model(), [message({ id: "m1" })]));
    expect(painted).not.toContain("Cc:");
    expect(painted).not.toContain("Bcc:");
  });

  it("shows both an absolute and a relative date", () => {
    const painted = frame(openReader(model(), [message({ id: "m1" })]));
    expect(painted).toMatch(/Date:\s+2026-08-15 \d\d:\d\d\s+\(1h ago\)/);
  });

  it("explains an HTML-only message instead of showing an empty body", () => {
    const opened = openReader(model(), [
      message({ id: "m1", textBody: "  ", htmlAvailable: true })
    ]);
    expect(frame(opened)).toContain("no plain-text part");
  });

  it("lists attachment names", () => {
    const opened = openReader(model(), [
      message({
        id: "m1",
        attachments: [
          {
            id: "a1",
            filename: "report.pdf",
            contentType: "application/pdf",
            sizeBytes: 10,
            contentId: null
          }
        ]
      })
    ]);
    expect(frame(opened)).toContain("report.pdf");
  });

  it("offers the action keys only when the connection can write", () => {
    const writable = openReader(model(), [message({ id: "m1" })]);
    expect(keys(writable)).toContain("a archive");
    const readOnly = openReader(model({ canWrite: false }), [message({ id: "m1" })]);
    expect(keys(readOnly)).not.toContain("a archive");
    expect(status(readOnly)).toContain("read-only");
  });

  it("always ends with a key-hint line", () => {
    expect(keys(model())).toContain("→ read");
    expect(keys(model())).toContain("enter actions");
    expect(keys(model())).toContain("← clear");
    expect(keys(model())).toContain("ctrl+c quit");
  });

  it("shows the reader's own keys once a conversation is open", () => {
    const opened = openReader(model(), [message({ id: "m1" })]);
    expect(keys(opened)).toContain("←/q back");
    expect(keys(opened)).toContain("↑↓ scroll");
  });

  it("drops whole hints from the tail rather than truncating mid-word", () => {
    const narrow = keys(model({ width: 34 }));
    expect(displayWidth(narrow)).toBeLessThan(34);
    expect(narrow).not.toContain("…");
    expect(narrow).toContain("→ read");
    expect(narrow).toContain("ctrl+c quit");
    expect(narrow).not.toContain("search bodies");
  });

  it("keeps the quit hint even when nothing else fits", () => {
    const tiny = keys(model({ width: 22 }));
    expect(tiny).toBe("ctrl+c quit");
  });

  it("keeps the key line even when a notice takes over the status line", () => {
    const [next] = update(model(), { type: "offline", text: "Workspace unreachable." }, now);
    expect(status(next)).toContain("Workspace unreachable.");
    expect(keys(next)).toContain("ctrl+c quit");
  });

  it("draws an inline image inside the frame when the terminal supports it", () => {
    const opened = openReader(model(), [
      message({
        id: "m1",
        attachments: [
          {
            id: "a1",
            filename: "chart.png",
            contentType: "image/png",
            sizeBytes: 2,
            contentId: null
          }
        ]
      })
    ]);
    const ready = {
      ...opened,
      height: 40,
      images: { a1: { status: "ready" as const, base64: "aGk=", bytes: 2 } }
    };
    expect(render(ready, { now, protocol: "iterm" })).toContain("1337;File=inline=1");
    expect(render(ready, { now, protocol: "none" })).toContain("cannot display images");
  });

  it("never renders a line wider than the terminal on a narrow screen", () => {
    const narrow = frame(model({ width: 40 }));
    for (const line of narrow.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

function openReader(state: Model, messages: MessageDetail[]): Model {
  const [opened] = update(state, { type: "key", key: { kind: "right" } }, now);
  const [loaded] = update(
    opened,
    { type: "thread", conversationId: opened.reader?.conversationId ?? "", messages },
    now
  );
  return loaded;
}

function message(overrides: Partial<MessageDetail> & { id: string }): MessageDetail {
  return {
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
    readAt: null,
    starredAt: null,
    hasAttachments: false,
    createdAt: "2026-08-15T11:00:00.000Z",
    textBody: "Body",
    htmlAvailable: false,
    attachments: [],
    ...overrides
  };
}
