import { detectImageProtocol, drawImage, isDrawableImage } from "@tui/ui/images";
import { describe, expect, it } from "vitest";

const ESC = "\u001b";
const BEL = "\u0007";
const png = { base64: "aGVsbG8=", bytes: 5, contentType: "image/png" };

describe("detectImageProtocol", () => {
  it("recognizes the terminals that speak each protocol", () => {
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" }, true)).toBe("iterm");
    expect(detectImageProtocol({ TERM_PROGRAM: "WezTerm" }, true)).toBe("iterm");
    expect(detectImageProtocol({ TERM: "xterm-kitty" }, true)).toBe("kitty");
    expect(detectImageProtocol({ KITTY_WINDOW_ID: "1" }, true)).toBe("kitty");
    expect(detectImageProtocol({ TERM_PROGRAM: "ghostty" }, true)).toBe("kitty");
  });

  it("assumes nothing about an unrecognized terminal", () => {
    expect(detectImageProtocol({ TERM: "xterm-256color" }, true)).toBe("none");
    expect(detectImageProtocol({}, true)).toBe("none");
  });

  it("refuses inside a multiplexer, which would mangle the sequence", () => {
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app", TMUX: "/tmp/x" }, true)).toBe("none");
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app", TERM: "screen-256color" }, true)).toBe(
      "none"
    );
  });

  it("refuses when output is not a terminal", () => {
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" }, false)).toBe("none");
  });

  it("can be turned off explicitly", () => {
    expect(
      detectImageProtocol({ TERM_PROGRAM: "iTerm.app", HQBASE_MAIL_IMAGES: "off" }, true)
    ).toBe("none");
  });
});

describe("isDrawableImage", () => {
  it("accepts the image types mail actually carries", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
      expect(isDrawableImage(type)).toBe(true);
    }
  });

  it("ignores parameters on the content type", () => {
    expect(isDrawableImage("image/png; name=chart.png")).toBe(true);
    expect(isDrawableImage("IMAGE/PNG")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isDrawableImage("application/pdf")).toBe(false);
    expect(isDrawableImage("image/svg+xml")).toBe(false);
    expect(isDrawableImage("")).toBe(false);
  });
});

describe("drawImage", () => {
  it("emits an iTerm2 inline image with a fixed row height", () => {
    const drawing = drawImage("iterm", png, 10);
    expect(drawing?.rows).toBe(10);
    expect(drawing?.escape).toBe(
      `${ESC}]1337;File=inline=1;size=5;height=10;width=auto;preserveAspectRatio=1:aGVsbG8=${BEL}`
    );
  });

  it("emits a kitty transmit-and-display sequence", () => {
    const drawing = drawImage("kitty", png, 8);
    expect(drawing?.escape).toBe(`${ESC}_Ga=T,f=100,r=8,m=0;aGVsbG8=${ESC}\\`);
  });

  it("chunks a large payload for kitty and closes the sequence", () => {
    const large = { ...png, base64: "A".repeat(9000) };
    const sequence = drawImage("kitty", large, 8)?.escape ?? "";
    const chunks = sequence.split(`${ESC}\\`).filter(Boolean);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("m=1");
    expect(chunks.at(-1)).toContain("m=0");
    // Every chunk together must reconstitute the payload exactly, or the
    // terminal decodes a truncated image.
    const payload = chunks.map((chunk) => chunk.slice(chunk.indexOf(";") + 1)).join("");
    expect(payload).toBe("A".repeat(9000));
  });

  it("carries any image format over the iTerm2 protocol", () => {
    expect(drawImage("iterm", { ...png, contentType: "image/jpeg" }, 4)).not.toBeNull();
  });

  it("declines a format kitty cannot decode itself", () => {
    expect(drawImage("kitty", { ...png, contentType: "image/jpeg" }, 4)).toBeNull();
    expect(drawImage("kitty", { ...png, contentType: "image/gif" }, 4)).toBeNull();
  });

  it("declines when there is no protocol, no rows, or no image", () => {
    expect(drawImage("none", png, 10)).toBeNull();
    expect(drawImage("iterm", png, 0)).toBeNull();
    expect(drawImage("iterm", { ...png, contentType: "application/pdf" }, 10)).toBeNull();
  });
});
