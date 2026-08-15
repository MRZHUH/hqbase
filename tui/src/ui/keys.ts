export type Key =
  | { kind: "char"; value: string }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "page-up" }
  | { kind: "page-down" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "tab" }
  | { kind: "quit" }
  | { kind: "control"; value: string };

const ESC = "\u001b";
const DEL = "\u007f";
const INTERRUPT = "\u0003";
const EOF = "\u0004";

// Longest first, so `ESC[1~` is never mistaken for a prefix of a shorter match.
const sequences: ReadonlyArray<readonly [string, Key]> = [
  [`${ESC}[1~`, { kind: "home" }],
  [`${ESC}[4~`, { kind: "end" }],
  [`${ESC}[5~`, { kind: "page-up" }],
  [`${ESC}[6~`, { kind: "page-down" }],
  [`${ESC}[3~`, { kind: "delete" }],
  [`${ESC}[A`, { kind: "up" }],
  [`${ESC}[B`, { kind: "down" }],
  [`${ESC}[C`, { kind: "right" }],
  [`${ESC}[D`, { kind: "left" }],
  [`${ESC}[H`, { kind: "home" }],
  [`${ESC}[F`, { kind: "end" }],
  [`${ESC}OH`, { kind: "home" }],
  [`${ESC}OF`, { kind: "end" }]
];

/**
 * Decodes one chunk of raw terminal input into key events.
 *
 * A paste arrives as a single chunk of many characters, so the decoder walks the
 * whole chunk instead of assuming one keypress per read.
 */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let index = 0;

  while (index < chunk.length) {
    const matched = matchSequence(chunk.slice(index));
    if (matched) {
      keys.push(matched.key);
      index += matched.length;
      continue;
    }

    const character = chunk[index] ?? "";
    index += 1;

    if (character === INTERRUPT || character === EOF) {
      keys.push({ kind: "quit" });
      continue;
    }
    if (character === "\r" || character === "\n") {
      keys.push({ kind: "enter" });
      continue;
    }
    if (character === DEL || character === "\b") {
      keys.push({ kind: "backspace" });
      continue;
    }
    if (character === "\t") {
      keys.push({ kind: "tab" });
      continue;
    }
    if (character === ESC) {
      keys.push({ kind: "escape" });
      continue;
    }

    const code = character.charCodeAt(0);
    if (code < 32) {
      // Control characters are reported by the letter they are typed with, so a
      // handler asks for "r" rather than for a byte value.
      keys.push({ kind: "control", value: String.fromCharCode(code + 96) });
      continue;
    }
    keys.push({ kind: "char", value: character });
  }

  return keys;
}

export function isControl(key: Key, value: string): boolean {
  return key.kind === "control" && key.value === value;
}

function matchSequence(remainder: string): { key: Key; length: number } | null {
  for (const [sequence, key] of sequences) {
    if (remainder.startsWith(sequence)) return { key, length: sequence.length };
  }
  return null;
}
