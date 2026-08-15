import { ansiPattern } from "./ansi-pattern.js";

/**
 * Terminal column arithmetic.
 *
 * A terminal lays out cells, not JavaScript characters, and the two are not the
 * same: a CJK ideograph occupies two columns, a combining mark occupies none,
 * and an emoji occupies two. Measuring with `String.length` makes any row
 * containing them overflow the terminal, which wraps the line, bleeds the
 * selected row's background onto the next one, and pushes the rest of the frame
 * off screen.
 */

const ranges: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul compatibility, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji: symbols and pictographs, emoticons
  [0x1f900, 0x1f9ff], // Emoji: supplemental symbols and pictographs
  [0x20000, 0x3fffd] // CJK unified ideographs extensions B and beyond
];

/**
 * East Asian Ambiguous characters, which are one column on a Western terminal
 * and two on a CJK-configured one. There is no way to know which without asking
 * the terminal, so they are counted as two: over-reserving leaves an unused
 * column, while under-reserving wraps the line and corrupts the frame.
 */
const ambiguous: ReadonlyArray<readonly [number, number]> = [
  [0x00a1, 0x00a1],
  [0x00a4, 0x00a4],
  [0x00a7, 0x00a8],
  [0x00aa, 0x00aa],
  [0x00ad, 0x00ae],
  [0x00b0, 0x00b4],
  [0x00b6, 0x00ba],
  [0x00bc, 0x00bf],
  [0x2010, 0x2010],
  [0x2013, 0x2016],
  [0x2018, 0x2019],
  [0x201c, 0x201d],
  [0x2020, 0x2022],
  [0x2024, 0x2027],
  [0x2030, 0x2030],
  [0x2032, 0x2033],
  [0x2035, 0x2035],
  [0x203b, 0x203b],
  [0x2103, 0x2103],
  [0x2105, 0x2105],
  [0x2109, 0x2109],
  [0x2113, 0x2113],
  [0x2116, 0x2116],
  [0x2121, 0x2122],
  [0x2126, 0x2126],
  [0x212b, 0x212b],
  [0x2153, 0x2154],
  [0x215b, 0x215e],
  [0x2160, 0x216b],
  [0x2170, 0x2179],
  [0x2190, 0x2199],
  [0x21d2, 0x21d2],
  [0x21d4, 0x21d4],
  [0x2200, 0x22ff],
  [0x2460, 0x24ff],
  [0x2500, 0x254b],
  [0x2550, 0x2573],
  [0x2580, 0x258f],
  [0x2592, 0x2595],
  [0x25a0, 0x25a1],
  [0x25a3, 0x25a9],
  [0x25b2, 0x25b3],
  [0x25b6, 0x25b7],
  [0x25bc, 0x25bd],
  [0x25c0, 0x25c1],
  [0x25c6, 0x25c8],
  [0x25cb, 0x25cb],
  [0x25ce, 0x25d1],
  [0x25e2, 0x25e5],
  [0x25ef, 0x25ef],
  [0x2605, 0x2606],
  [0x2609, 0x2609],
  [0x260e, 0x260f],
  [0x2614, 0x2615],
  [0x261c, 0x261c],
  [0x261e, 0x261e],
  [0x2640, 0x2640],
  [0x2642, 0x2642],
  [0x2660, 0x2661],
  [0x2663, 0x2665],
  [0x2667, 0x266a],
  [0x266c, 0x266d],
  [0x266f, 0x266f],
  [0x273d, 0x273d],
  [0x2776, 0x277f]
];

export function stripAnsi(value: string): string {
  return value.replace(ansiPattern(), "");
}

export function charWidth(codePoint: number): number {
  if (codePoint === 0) return 0;
  // C0/C1 controls and combining marks take no cell of their own.
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isCombining(codePoint)) return 0;
  if (inRanges(codePoint, ranges) || inRanges(codePoint, ambiguous)) return 2;
  return 1;
}

/** Columns a string occupies, ignoring any escape sequences inside it. */
export function displayWidth(value: string): number {
  let total = 0;
  for (const character of stripAnsi(value)) {
    total += charWidth(character.codePointAt(0) ?? 0);
  }
  return total;
}

/**
 * Cuts a string to at most `columns` cells, never splitting a wide character in
 * half — half of an ideograph is not a character the terminal can draw.
 */
export function sliceColumns(value: string, columns: number): string {
  if (columns <= 0) return "";
  let used = 0;
  let out = "";
  for (const character of value) {
    const width = charWidth(character.codePointAt(0) ?? 0);
    if (used + width > columns) break;
    out += character;
    used += width;
  }
  return out;
}

export function padColumns(value: string, columns: number): string {
  const width = displayWidth(value);
  return width >= columns ? value : value + " ".repeat(columns - width);
}

/** Repeats a character to fill exactly `columns` cells where it divides evenly. */
export function repeatToWidth(character: string, columns: number): string {
  const width = charWidth(character.codePointAt(0) ?? 0) || 1;
  return character.repeat(Math.max(Math.floor(columns / width), 0));
}

function inRanges(codePoint: number, table: ReadonlyArray<readonly [number, number]>): boolean {
  let low = 0;
  let high = table.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = table[middle];
    if (!entry) break;
    if (codePoint < entry[0]) high = middle - 1;
    else if (codePoint > entry[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function isCombining(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    codePoint === 0x200b ||
    codePoint === 0x200d
  );
}
