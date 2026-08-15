import {
  conversationRow,
  flags,
  headerRow,
  layout,
  pad,
  relativeTime,
  sender,
  truncate,
  wrap
} from "@tui/ui/format";

import { decodeKeys, isControl } from "@tui/ui/keys";
import { displayWidth } from "@tui/ui/width";
import { describe, expect, it } from "vitest";

import { conversation, now } from "./fixtures";

describe("layout", () => {
  it("keeps every column on a wide terminal", () => {
    const columns = layout(120);
    expect(columns.from).toBeGreaterThan(0);
    expect(columns.date).toBeGreaterThan(0);
    expect(columns.subject).toBeGreaterThan(0);
  });

  it("drops the sender before the date", () => {
    expect(layout(50).from).toBe(0);
    expect(layout(50).date).toBe(0);
  });

  it("reserves enough columns for every flag marker at once", () => {
    const columns = layout(100);
    const all = flags(
      conversation({
        id: "c",
        unreadCount: 1,
        isStarred: true,
        hasAttachments: true,
        messageCount: 3
      })
    );
    expect(displayWidth(all)).toBeLessThanOrEqual(columns.flags);
    expect(pad(all, columns.flags)).not.toContain("…");
  });

  it("always leaves room for the subject", () => {
    expect(layout(10).subject).toBeGreaterThanOrEqual(8);
  });

  it("leaves the last column unused so a styled row cannot wrap", () => {
    for (const width of [20, 40, 60, 80, 120]) {
      const columns = layout(width);
      const row = conversationRow(conversation({ id: "c" }), columns, now);
      expect(displayWidth(row)).toBeLessThan(Math.max(width, 21));
      expect(displayWidth(headerRow(columns))).toBe(displayWidth(row));
    }
  });

  it("measures a CJK subject in columns, not characters", () => {
    const columns = layout(80);
    const row = conversationRow(
      conversation({ id: "c", subject: "第一封邮件的中文标题很长很长很长很长" }),
      columns,
      now
    );
    expect(displayWidth(row)).toBe(displayWidth(headerRow(columns)));
    expect(row.length).toBeLessThan(displayWidth(row));
  });
});

describe("flags", () => {
  it("marks unread, starred, attachments, and multi-message threads", () => {
    expect(flags(conversation({ id: "c", unreadCount: 2 })).trim()).toContain("●");
    expect(flags(conversation({ id: "c", isStarred: true })).trim()).toContain("★");
    expect(flags(conversation({ id: "c", hasAttachments: true })).trim()).toContain("@");
    expect(flags(conversation({ id: "c", messageCount: 3 })).trim()).toContain("+");
    expect(flags(conversation({ id: "c" })).trim()).toBe("");
  });
});

describe("sender", () => {
  it("prefers a display name", () => {
    expect(sender("Alice Green <alice@example.com>")).toBe("Alice Green");
    expect(sender('"Alice Green" <alice@example.com>')).toBe("Alice Green");
  });

  it("falls back to the address", () => {
    expect(sender("alice@example.com")).toBe("alice@example.com");
    expect(sender("<alice@example.com>")).toBe("alice@example.com");
  });

  it("never renders an empty cell", () => {
    expect(sender("   ")).toBe("(unknown)");
  });
});

describe("relativeTime", () => {
  it("counts up through seconds, minutes, hours, and days", () => {
    expect(relativeTime("2026-08-15T11:59:30.000Z", now)).toBe("30s ago");
    expect(relativeTime("2026-08-15T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeTime("2026-08-15T06:00:00.000Z", now)).toBe("6h ago");
    expect(relativeTime("2026-08-10T12:00:00.000Z", now)).toBe("5d ago");
  });

  it("falls back to a date beyond a month", () => {
    expect(relativeTime("2026-01-02T12:00:00.000Z", now)).toBe("2026-01-02");
  });

  it("returns nothing for an unparsable timestamp", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("truncate and wrap", () => {
  it("ellipsizes rather than overflowing", () => {
    // The ellipsis is East Asian Ambiguous and is reserved two columns.
    expect(truncate("abcdefgh", 4)).toBe("ab…");
    expect(displayWidth(truncate("abcdefgh", 4))).toBeLessThanOrEqual(4);
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("never cuts a wide character in half", () => {
    const cut = truncate("中文标题很长", 5);
    expect(displayWidth(cut)).toBeLessThanOrEqual(5);
    expect(cut).not.toContain("\ufffd");
  });

  it("collapses whitespace so a row stays one line", () => {
    expect(truncate("a\n b   c", 20)).toBe("a b c");
  });

  it("wraps at the requested width and keeps blank lines", () => {
    const lines = wrap("one two three\n\nfour", 9);
    expect(lines).toEqual(["one two", "three", "", "four"]);
  });

  it("breaks a word longer than the width", () => {
    expect(wrap("abcdefghij", 4).every((line) => line.length <= 4)).toBe(true);
  });
});

describe("decodeKeys", () => {
  const ESC = "\u001b";

  it("decodes printable characters", () => {
    expect(decodeKeys("hi")).toEqual([
      { kind: "char", value: "h" },
      { kind: "char", value: "i" }
    ]);
  });

  it("decodes arrows and paging", () => {
    expect(decodeKeys(`${ESC}[A`)).toEqual([{ kind: "up" }]);
    expect(decodeKeys(`${ESC}[B`)).toEqual([{ kind: "down" }]);
    expect(decodeKeys(`${ESC}[5~`)).toEqual([{ kind: "page-up" }]);
    expect(decodeKeys(`${ESC}[6~`)).toEqual([{ kind: "page-down" }]);
  });

  it("decodes enter, escape, backspace, and interrupt", () => {
    expect(decodeKeys("\r")).toEqual([{ kind: "enter" }]);
    expect(decodeKeys(ESC)).toEqual([{ kind: "escape" }]);
    expect(decodeKeys("\u007f")).toEqual([{ kind: "backspace" }]);
    expect(decodeKeys("\u0003")).toEqual([{ kind: "quit" }]);
  });

  it("decodes control characters by their letter", () => {
    const [key] = decodeKeys("\u0012");
    expect(key && isControl(key, "r")).toBe(true);
  });

  it("walks a pasted chunk instead of taking one keypress from it", () => {
    expect(decodeKeys(`ab${ESC}[Ac`)).toEqual([
      { kind: "char", value: "a" },
      { kind: "char", value: "b" },
      { kind: "up" },
      { kind: "char", value: "c" }
    ]);
  });
});
