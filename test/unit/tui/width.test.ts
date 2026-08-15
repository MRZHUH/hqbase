import { styling } from "@tui/ui/ansi";
import {
  charWidth,
  displayWidth,
  padColumns,
  repeatToWidth,
  sliceColumns,
  stripAnsi
} from "@tui/ui/width";
import { describe, expect, it } from "vitest";

describe("charWidth", () => {
  it("counts an ASCII character as one column", () => {
    expect(charWidth("a".codePointAt(0) ?? 0)).toBe(1);
    expect(charWidth(" ".codePointAt(0) ?? 0)).toBe(1);
  });

  it("counts a CJK ideograph as two columns", () => {
    expect(charWidth("中".codePointAt(0) ?? 0)).toBe(2);
    expect(charWidth("邮".codePointAt(0) ?? 0)).toBe(2);
    expect(charWidth("한".codePointAt(0) ?? 0)).toBe(2);
    expect(charWidth("あ".codePointAt(0) ?? 0)).toBe(2);
  });

  it("counts fullwidth punctuation as two columns", () => {
    expect(charWidth("，".codePointAt(0) ?? 0)).toBe(2);
    expect(charWidth("Ａ".codePointAt(0) ?? 0)).toBe(2);
  });

  it("counts an emoji as two columns", () => {
    expect(charWidth("📎".codePointAt(0) ?? 0)).toBe(2);
  });

  it("reserves two columns for East Asian Ambiguous characters", () => {
    // One column on a Western terminal and two on a CJK one. Over-reserving
    // wastes a column; under-reserving wraps the line and corrupts the frame.
    for (const character of ["●", "★", "…", "·", "─", "│", "↑", "→"]) {
      expect(charWidth(character.codePointAt(0) ?? 0)).toBe(2);
    }
  });

  it("counts a combining mark as no column of its own", () => {
    expect(charWidth(0x0301)).toBe(0);
    expect(charWidth(0x200d)).toBe(0);
  });

  it("counts control characters as nothing", () => {
    expect(charWidth(0)).toBe(0);
    expect(charWidth(9)).toBe(0);
  });
});

describe("displayWidth", () => {
  it("sums the columns of a mixed string", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("中文")).toBe(4);
    expect(displayWidth("a中b")).toBe(4);
  });

  it("ignores styling escapes, which occupy no cells", () => {
    const styles = styling(true);
    expect(displayWidth(styles.bold("abc"))).toBe(3);
    expect(displayWidth(styles.apply("中文", "inverse", "bold"))).toBe(4);
  });

  it("ignores an image escape sequence entirely", () => {
    const ESC = "\u001b";
    const BEL = "\u0007";
    expect(displayWidth(`${ESC}]1337;File=inline=1;size=2:aGk=${BEL}`)).toBe(0);
    expect(displayWidth(`${ESC}_Ga=T,f=100,r=8,m=0;aGk=${ESC}\\`)).toBe(0);
  });

  it("is never fooled by string length", () => {
    expect("中文标题".length).toBe(4);
    expect(displayWidth("中文标题")).toBe(8);
  });
});

describe("stripAnsi", () => {
  it("removes styling but keeps the text", () => {
    expect(stripAnsi(styling(true).bold("hello"))).toBe("hello");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });
});

describe("sliceColumns", () => {
  it("cuts to a column budget", () => {
    expect(sliceColumns("abcdef", 3)).toBe("abc");
  });

  it("never splits a wide character in half", () => {
    expect(sliceColumns("中文", 3)).toBe("中");
    expect(sliceColumns("中文", 4)).toBe("中文");
    expect(displayWidth(sliceColumns("中文标题", 5))).toBeLessThanOrEqual(5);
  });

  it("returns nothing for a budget of zero or less", () => {
    expect(sliceColumns("abc", 0)).toBe("");
    expect(sliceColumns("abc", -1)).toBe("");
  });
});

describe("padColumns", () => {
  it("pads to the requested columns", () => {
    expect(padColumns("ab", 5)).toBe("ab   ");
  });

  it("pads a wide string by columns, not characters", () => {
    expect(displayWidth(padColumns("中文", 8))).toBe(8);
    expect(padColumns("中文", 8)).toBe("中文    ");
  });

  it("leaves an over-long string alone rather than corrupting it", () => {
    expect(padColumns("abcdef", 3)).toBe("abcdef");
  });
});

describe("repeatToWidth", () => {
  it("fills the columns asked for", () => {
    expect(displayWidth(repeatToWidth("-", 10))).toBe(10);
  });

  it("accounts for a wide fill character", () => {
    expect(displayWidth(repeatToWidth("─", 10))).toBeLessThanOrEqual(10);
  });
});
