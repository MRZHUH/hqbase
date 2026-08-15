const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

export type ImageProtocol = "iterm" | "kitty" | "none";

/** Image types a terminal can be asked to draw. */
const drawable = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export function isDrawableImage(contentType: string): boolean {
  return drawable.has(normalizeContentType(contentType));
}

export function normalizeContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * Which inline-image protocol this terminal speaks, if any.
 *
 * Detection is by environment rather than by querying the terminal, because a
 * query needs a reply read off stdin and would race the key handler. Guessing
 * wrong in the permissive direction would spray escape bytes across someone's
 * screen, so anything unrecognized is treated as "none" and gets the text
 * description instead.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

export function detectImageProtocol(env: Environment = process.env, isTTY = true): ImageProtocol {
  if (!isTTY) return "none";
  if (env.HQBASE_MAIL_IMAGES === "off") return "none";
  // Multiplexers rewrite escape sequences and would swallow or corrupt these.
  if (env.TMUX || env.STY || env.TERM?.startsWith("screen")) return "none";

  const program = env.TERM_PROGRAM ?? "";
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || program === "ghostty") return "kitty";
  if (program === "iTerm.app" || program === "WezTerm" || env.WEZTERM_PANE) return "iterm";
  if (env.KONSOLE_VERSION) return "iterm";
  return "none";
}

export type Drawing = {
  /** The escape sequence to emit. */
  escape: string;
  /** Terminal rows the drawing occupies once emitted. */
  rows: number;
};

/**
 * Encodes an image for the given protocol. Returns null when the protocol
 * cannot carry this image, so the caller falls back to describing it.
 */
export function drawImage(
  protocol: ImageProtocol,
  image: { base64: string; bytes: number; contentType: string },
  rows: number
): Drawing | null {
  if (protocol === "none" || rows < 1) return null;
  if (!isDrawableImage(image.contentType)) return null;

  if (protocol === "iterm") {
    const options = [
      "inline=1",
      `size=${image.bytes}`,
      `height=${rows}`,
      "width=auto",
      "preserveAspectRatio=1"
    ].join(";");
    return { escape: `${ESC}]1337;File=${options}:${image.base64}${BEL}`, rows };
  }

  // Kitty transmits arbitrary formats only as raw pixel data; PNG is the one
  // compressed format it decodes itself, so anything else falls back to text.
  if (normalizeContentType(image.contentType) !== "image/png") return null;
  return { escape: kittyEscape(image.base64, rows), rows };
}

function kittyEscape(base64: string, rows: number): string {
  const limit = 4096;
  if (base64.length <= limit) {
    return `${ESC}_Ga=T,f=100,r=${rows},m=0;${base64}${ST}`;
  }
  const parts: string[] = [];
  for (let index = 0; index < base64.length; index += limit) {
    const chunk = base64.slice(index, index + limit);
    const more = index + limit < base64.length ? 1 : 0;
    parts.push(
      index === 0
        ? `${ESC}_Ga=T,f=100,r=${rows},m=${more};${chunk}${ST}`
        : `${ESC}_Gm=${more};${chunk}${ST}`
    );
  }
  return parts.join("");
}
