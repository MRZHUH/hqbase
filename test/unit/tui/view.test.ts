import type { MessageDetail } from "@tui/api/types";
import { initialModel, type Model, refresh } from "@tui/ui/model";
import { update } from "@tui/ui/update";
import { render } from "@tui/ui/view";
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

describe("render", () => {
  it("puts the query on the first line and the status on the last", () => {
    const lines = frame(model({ query: "invoice" })).split("\n");
    expect(lines[0]).toContain("invoice");
    expect(lines.at(-1)).toContain("mail.example.com");
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
    const status = frame(model()).split("\n").at(-1) ?? "";
    expect(status).toContain("3/3 cached");
    expect(status).toContain("synced 5m ago");
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
    expect(frame(next).split("\n").at(-1)).toContain("2 new");
  });

  it("says the workspace is unreachable", () => {
    const [next] = update(model(), { type: "offline", text: "Workspace unreachable." }, now);
    expect(frame(next)).toContain("Workspace unreachable.");
  });

  it("renders a thread with senders, recipients, and bodies", () => {
    const opened = openReader(model(), [message({ id: "m1", textBody: "First message body." })]);
    const painted = frame(opened);
    expect(painted).toContain("alice@example.com");
    expect(painted).toContain("to team@example.com");
    expect(painted).toContain("First message body.");
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
          { id: "a1", filename: "report.pdf", contentType: "application/pdf", sizeBytes: 10 }
        ]
      })
    ]);
    expect(frame(opened)).toContain("report.pdf");
  });

  it("offers the action keys only when the connection can write", () => {
    const writable = openReader(model(), [message({ id: "m1" })]);
    expect(frame(writable)).toContain("a archive");
    const readOnly = openReader(model({ canWrite: false }), [message({ id: "m1" })]);
    expect(frame(readOnly)).toContain("read-only");
  });

  it("never renders a line wider than the terminal on a narrow screen", () => {
    const narrow = frame(model({ width: 40 }));
    for (const line of narrow.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

function openReader(state: Model, messages: MessageDetail[]): Model {
  const [opened] = update(state, { type: "key", key: { kind: "enter" } }, now);
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
