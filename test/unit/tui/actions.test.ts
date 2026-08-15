import type { Key } from "@tui/ui/keys";
import { type Effect, initialModel, type Model, menuItems, refresh } from "@tui/ui/model";
import { update } from "@tui/ui/update";
import { render } from "@tui/ui/view";
import { displayWidth } from "@tui/ui/width";
import { describe, expect, it } from "vitest";

import { conversation, now } from "./fixtures";

const rows = [
  conversation({ id: "c1", subject: "Unread one", unreadCount: 1 }),
  conversation({
    id: "c2",
    subject: "Read one",
    unreadCount: 0,
    readAt: "2026-08-14T09:00:00.000Z",
    activityAt: "2026-08-14T09:00:00.000Z"
  }),
  conversation({
    id: "c3",
    subject: "Unread two",
    unreadCount: 1,
    activityAt: "2026-08-13T09:00:00.000Z"
  })
];

function start(overrides: Partial<Model> = {}): Model {
  const base = initialModel({
    origin: "https://mail.example.com",
    version: "test",
    width: 100,
    height: 24,
    canWrite: true,
    lastSyncAt: null
  });
  return refresh({ ...base, conversations: rows, ...overrides }, now);
}

function press(model: Model, key: Key): [Model, Effect[]] {
  return update(model, { type: "key", key }, now);
}

function frame(model: Model): string {
  return render(model, { now });
}

describe("the action menu", () => {
  it("opens on enter for the selected conversation", () => {
    const [model, effects] = press(start(), { kind: "enter" });
    expect(effects).toEqual([]);
    expect(model.overlay).toEqual({
      kind: "actions",
      conversationId: "c1",
      subject: "Unread one",
      selected: 0
    });
  });

  it("does not open the conversation, which stays on the right arrow", () => {
    expect(press(start(), { kind: "enter" })[0].screen).toBe("list");
    expect(press(start(), { kind: "right" })[0].screen).toBe("reader");
  });

  it("offers mark read, delete, and mark unread", () => {
    expect(menuItems.map((item) => item.action)).toEqual(["read", "trash", "unread"]);
    const painted = frame(press(start(), { kind: "enter" })[0]);
    expect(painted).toContain("1. Mark as read");
    expect(painted).toContain("2. Delete (move to trash)");
    expect(painted).toContain("3. Mark as unread");
  });

  it("names the conversation it will act on", () => {
    expect(frame(press(start(), { kind: "enter" })[0])).toContain("Unread one");
  });

  it("moves between entries and applies the chosen one", () => {
    let model = press(start(), { kind: "enter" })[0];
    [model] = press(model, { kind: "down" });
    const [applied, effects] = press(model, { kind: "enter" });
    expect(effects).toEqual([
      { type: "act", conversationId: "c1", action: "trash", folder: "inbox" }
    ]);
    expect(applied.overlay).toBeNull();
  });

  it("picks an entry by its number", () => {
    let model = press(start(), { kind: "enter" })[0];
    [model] = press(model, { kind: "char", value: "3" });
    expect(model.overlay).toMatchObject({ selected: 2 });
    const [, effects] = press(model, { kind: "enter" });
    expect(effects).toEqual([
      { type: "act", conversationId: "c1", action: "unread", folder: "inbox" }
    ]);
  });

  it("never moves the selection past either end", () => {
    let model = press(start(), { kind: "enter" })[0];
    [model] = press(model, { kind: "up" });
    expect(model.overlay).toMatchObject({ selected: 0 });
    for (let index = 0; index < 10; index += 1) [model] = press(model, { kind: "down" });
    expect(model.overlay).toMatchObject({ selected: menuItems.length - 1 });
  });

  it("closes without acting on escape or the left arrow", () => {
    for (const key of [{ kind: "escape" } as const, { kind: "left" } as const]) {
      const [model, effects] = press(press(start(), { kind: "enter" })[0], key);
      expect(model.overlay).toBeNull();
      expect(effects).toEqual([]);
    }
  });

  it("swallows typing so a query keystroke cannot complete a decision", () => {
    const opened = press(start(), { kind: "enter" })[0];
    const [model, effects] = press(opened, { kind: "char", value: "x" });
    expect(model.query).toBe("");
    expect(effects).toEqual([]);
  });

  it("refuses to open on a read-only connection", () => {
    const [model, effects] = press(start({ canWrite: false }), { kind: "enter" });
    expect(model.overlay).toBeNull();
    expect(effects).toEqual([]);
    expect(model.notice?.text).toContain("read-only");
  });

  it("refuses to apply while the workspace is unreachable", () => {
    const opened = press(start(), { kind: "enter" })[0];
    const [offline] = update(opened, { type: "offline", text: "unreachable" }, now);
    const [model, effects] = press(offline, { kind: "enter" });
    expect(effects).toEqual([]);
    expect(model.notice?.kind).toBe("error");
  });

  it("shows its own key hints while it is up", () => {
    const painted = frame(press(start(), { kind: "enter" })[0]).split("\n");
    expect(painted.at(-1)).toContain("enter apply");
    expect(painted.at(-1)).toContain("esc cancel");
  });

  it("draws a box whose every line is the same width", () => {
    const painted = frame(press(start(), { kind: "enter" })[0]).split("\n");
    const box = painted.filter((line) => line.startsWith("+") || line.startsWith("|"));
    expect(box.length).toBeGreaterThan(4);
    const widths = new Set(box.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
  });

  it("aligns its box around a CJK subject", () => {
    const cjk = start({
      conversations: [conversation({ id: "c1", subject: "第一封邮件的中文标题" })]
    });
    const painted = frame(press(refresh(cjk, now), { kind: "enter" })[0]).split("\n");
    const box = painted.filter((line) => line.startsWith("+") || line.startsWith("|"));
    expect(new Set(box.map((line) => displayWidth(line))).size).toBe(1);
  });
});

describe("marking everything listed as read", () => {
  it("asks for confirmation rather than acting immediately", () => {
    const [model, effects] = press(start(), { kind: "control", value: "u" });
    expect(effects).toEqual([]);
    expect(model.overlay).toEqual({ kind: "confirm-all-read", count: 2 });
  });

  it("counts only the conversations that are actually unread", () => {
    const [model] = press(start(), { kind: "control", value: "u" });
    expect(model.overlay).toMatchObject({ count: 2 });
  });

  it("applies to exactly what the query has narrowed to", () => {
    let model = start();
    for (const value of "Unread two") [model] = press(model, { kind: "char", value });
    const [confirming] = press(model, { kind: "control", value: "u" });
    expect(confirming.overlay).toMatchObject({ count: 1 });
    const [, effects] = press(confirming, { kind: "enter" });
    expect(effects).toEqual([{ type: "mark-all-read", conversationIds: ["c3"], folder: "inbox" }]);
  });

  it("marks every unread conversation on confirmation", () => {
    const [confirming] = press(start(), { kind: "control", value: "u" });
    const [, effects] = press(confirming, { kind: "enter" });
    expect(effects).toEqual([
      { type: "mark-all-read", conversationIds: ["c1", "c3"], folder: "inbox" }
    ]);
  });

  it("does nothing on cancel", () => {
    const [confirming] = press(start(), { kind: "control", value: "u" });
    const [model, effects] = press(confirming, { kind: "escape" });
    expect(model.overlay).toBeNull();
    expect(effects).toEqual([]);
  });

  it("says so when everything listed is already read", () => {
    const readOnly = start({
      conversations: [conversation({ id: "c2", subject: "Read one", unreadCount: 0 })]
    });
    const [model, effects] = press(refresh(readOnly, now), { kind: "control", value: "u" });
    expect(model.overlay).toBeNull();
    expect(effects).toEqual([]);
    expect(model.notice?.text).toContain("already read");
  });

  it("refuses on a read-only connection", () => {
    const [model, effects] = press(start({ canWrite: false }), { kind: "control", value: "u" });
    expect(model.overlay).toBeNull();
    expect(effects).toEqual([]);
    expect(model.notice?.text).toContain("read-only");
  });

  it("reports how many were marked", () => {
    const [model, effects] = update(start(), { type: "marked-all-read", count: 2 }, now);
    expect(model.notice?.text).toContain("Marked 2 conversations as read.");
    expect(effects).toEqual([{ type: "reload" }]);
  });
});

describe("read and unread are visually distinct", () => {
  const ESC = "\u001b";

  function painted(): string {
    return render(start(), { color: true, now });
  }

  it("renders unread rows bold and read rows dim", () => {
    const lines = painted().split("\n");
    const unread = lines.find((line) => line.includes("Unread one")) ?? "";
    const read = lines.find((line) => line.includes("Read one")) ?? "";
    expect(unread).toContain(`${ESC}[7;1m`);
    expect(read).toContain(`${ESC}[2m`);
  });

  it("applies the selection and the read state in one sequence", () => {
    const selected =
      painted()
        .split("\n")
        .find((line) => line.includes("Unread one")) ?? "";
    // Two nested sequences would reset the inverse partway across the row.
    expect(selected.split(ESC).length - 1).toBe(2);
  });

  it("emits no styling at all when colour is off", () => {
    expect(render(start(), { now })).not.toContain(ESC);
  });
});
