import type { MessageDetail } from "@tui/api/types";
import type { Key } from "@tui/ui/keys";
import { type Effect, initialModel, type Model, refresh } from "@tui/ui/model";
import { update } from "@tui/ui/update";
import { describe, expect, it } from "vitest";

import { now, sample } from "./fixtures";

function start(overrides: Partial<Model> = {}): Model {
  const base = initialModel({
    origin: "https://mail.example.com",
    version: "test",
    width: 100,
    height: 20,
    canWrite: true,
    lastSyncAt: null
  });
  return refresh({ ...base, conversations: sample, ...overrides }, now);
}

function press(model: Model, key: Key): [Model, Effect[]] {
  return update(model, { type: "key", key }, now);
}

function type(model: Model, text: string): Model {
  let next = model;
  for (const value of text) [next] = press(next, { kind: "char", value });
  return next;
}

describe("typing", () => {
  it("filters the list on each keystroke without a network effect", () => {
    const [typed, effects] = press(start(), { kind: "char", value: "i" });
    expect(effects).toEqual([]);
    expect(typed.query).toBe("i");
    const narrowed = type(start(), "invoice");
    expect(narrowed.results.map((r) => r.conversation.id)).toEqual(["c2"]);
  });

  it("resets the selection when the query changes", () => {
    const moved = press(start(), { kind: "down" })[0];
    expect(moved.selected).toBe(1);
    expect(type(moved, "q").selected).toBe(0);
  });

  it("clears the query on escape and restores the full list", () => {
    const cleared = press(type(start(), "invoice"), { kind: "escape" })[0];
    expect(cleared.query).toBe("");
    expect(cleared.results).toHaveLength(sample.length);
  });

  it("edits at the cursor", () => {
    let model = type(start(), "abc");
    [model] = press(model, { kind: "left" });
    [model] = press(model, { kind: "char", value: "X" });
    expect(model.query).toBe("abXc");
    [model] = press(model, { kind: "backspace" });
    expect(model.query).toBe("abc");
  });

  it("reports a filter it could not understand", () => {
    expect(type(start(), "bogus:x").invalidTerms).toEqual(["bogus:x"]);
  });
});

describe("movement", () => {
  it("moves with arrows and their control equivalents", () => {
    expect(press(start(), { kind: "down" })[0].selected).toBe(1);
    expect(press(start(), { kind: "control", value: "n" })[0].selected).toBe(1);
    const second = press(start(), { kind: "down" })[0];
    expect(press(second, { kind: "control", value: "p" })[0].selected).toBe(0);
  });

  it("never moves past either end", () => {
    expect(press(start(), { kind: "up" })[0].selected).toBe(0);
    expect(press(start(), { kind: "end" })[0].selected).toBe(sample.length - 1);
    expect(press(press(start(), { kind: "end" })[0], { kind: "down" })[0].selected).toBe(
      sample.length - 1
    );
  });
});

describe("deep search", () => {
  it("asks the workspace for the free-text half of the query", () => {
    const [, effects] = press(type(start(), "invoice from:vendor"), {
      kind: "control",
      value: "r"
    });
    expect(effects).toEqual([{ type: "deep-search", search: "invoice" }]);
  });

  it("refuses when there is no free text to search for", () => {
    const [model, effects] = press(type(start(), "is:unread"), { kind: "control", value: "r" });
    expect(effects).toEqual([]);
    expect(model.notice?.kind).toBe("error");
  });

  it("marks that workspace results are included when it finishes", () => {
    const [model] = update(start(), { type: "deep-search-finished", found: 2 }, now);
    expect(model.includesServerResults).toBe(true);
    expect(model.notice?.text).toContain("2 matches");
  });
});

describe("reading a conversation", () => {
  it("opens the selected conversation and asks for its thread", () => {
    const [model, effects] = press(start(), { kind: "enter" });
    expect(model.screen).toBe("reader");
    expect(effects).toEqual([{ type: "open", conversationId: "c1", threadId: "thr_c1" }]);
  });

  it("keeps the query and the selection when returning", () => {
    let model = type(start(), "invoice");
    [model] = press(model, { kind: "enter" });
    [model] = press(model, { kind: "escape" });
    expect(model.screen).toBe("list");
    expect(model.query).toBe("invoice");
    expect(model.results.map((r) => r.conversation.id)).toEqual(["c2"]);
  });

  it("ignores a thread that arrives for a conversation no longer open", () => {
    const [opened] = press(start(), { kind: "enter" });
    const [model] = update(
      opened,
      { type: "thread", conversationId: "other", messages: [message()] },
      now
    );
    expect(model.reader?.messages).toEqual([]);
  });
});

describe("actions", () => {
  it("asks the workspace to apply an action from the reader", () => {
    const [opened] = press(start(), { kind: "enter" });
    const [, effects] = press(opened, { kind: "char", value: "a" });
    expect(effects).toEqual([
      { type: "act", conversationId: "c1", action: "archive", folder: "inbox" }
    ]);
  });

  it("explains a read-only connection instead of acting", () => {
    const [opened] = press(start({ canWrite: false }), { kind: "enter" });
    const [model, effects] = press(opened, { kind: "char", value: "a" });
    expect(effects).toEqual([]);
    expect(model.notice?.text).toContain("read-only");
  });

  it("refuses an action while the workspace is unreachable", () => {
    const [opened] = press(start(), { kind: "enter" });
    const [offline] = update(opened, { type: "offline", text: "unreachable" }, now);
    const [model, effects] = press(offline, { kind: "char", value: "a" });
    expect(effects).toEqual([]);
    expect(model.notice?.kind).toBe("error");
  });
});

describe("lifecycle", () => {
  it("quits on the interrupt key", () => {
    const [model, effects] = press(start(), { kind: "quit" });
    expect(model.quitting).toBe(true);
    expect(effects).toEqual([{ type: "quit" }]);
  });

  it("re-reads the cache after a sync", () => {
    const [model, effects] = update(
      start(),
      { type: "sync-finished", added: 3, updated: 1, truncated: false },
      now
    );
    expect(model.syncing).toBe(false);
    expect(effects).toEqual([{ type: "reload" }]);
    expect(model.notice?.text).toContain("3 new");
  });

  it("says when a sync stopped before the workspace ran out of pages", () => {
    const [model] = update(
      start(),
      { type: "sync-finished", added: 0, updated: 0, truncated: true },
      now
    );
    expect(model.notice?.text).toContain("run sync again");
  });

  it("keeps cached rows when the workspace becomes unreachable", () => {
    const [model] = update(start(), { type: "offline", text: "unreachable" }, now);
    expect(model.online).toBe(false);
    expect(model.results).toHaveLength(sample.length);
  });
});

function message(): MessageDetail {
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
    readAt: null,
    starredAt: null,
    hasAttachments: false,
    createdAt: "2026-08-15T11:00:00.000Z",
    textBody: "Numbers for the quarter are attached.",
    htmlAvailable: false,
    attachments: []
  };
}
