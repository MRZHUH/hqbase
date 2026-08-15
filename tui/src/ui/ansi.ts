const csi = "\u001b[";

export const ansi = {
  enterAlternateScreen: `${csi}?1049h`,
  leaveAlternateScreen: `${csi}?1049l`,
  hideCursor: `${csi}?25l`,
  showCursor: `${csi}?25h`,
  // Autowrap stays off while the interface owns the screen. Every frame is sized
  // to the terminal, so a line can only reach the last column by accident, and a
  // wrap there bleeds the selected row's background onto the next line and
  // pushes the rest of the frame off the bottom.
  disableAutowrap: `${csi}?7l`,
  enableAutowrap: `${csi}?7h`,
  clear: `${csi}2J${csi}H`,
  home: `${csi}H`,
  clearLine: `${csi}2K`
};

const codes = {
  bold: 1,
  dim: 2,
  inverse: 7,
  red: 31,
  yellow: 33,
  blue: 34,
  cyan: 36
} as const;

export type SgrName = keyof typeof codes;

/**
 * Styling is opt-in and degrades to plain text.
 *
 * `apply` takes every attribute at once instead of being nested, because nesting
 * emits an inner reset that ends the outer attribute early — a bold row inside
 * an inverse selection would lose its highlight partway across.
 */
export function styling(enabled: boolean) {
  const apply = (text: string, ...names: readonly SgrName[]): string => {
    if (!enabled || names.length === 0) return text;
    return `${csi}${names.map((name) => codes[name]).join(";")}m${text}${csi}0m`;
  };

  return {
    enabled,
    apply,
    bold: (text: string) => apply(text, "bold"),
    dim: (text: string) => apply(text, "dim"),
    inverse: (text: string) => apply(text, "inverse"),
    accent: (text: string) => apply(text, "cyan"),
    warn: (text: string) => apply(text, "yellow"),
    danger: (text: string) => apply(text, "red")
  };
}

export type Styles = ReturnType<typeof styling>;

export function colorEnabled(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  return stream.isTTY === true;
}
