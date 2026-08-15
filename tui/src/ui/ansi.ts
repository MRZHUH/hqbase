const csi = "\u001b[";

export const ansi = {
  enterAlternateScreen: `${csi}?1049h`,
  leaveAlternateScreen: `${csi}?1049l`,
  hideCursor: `${csi}?25l`,
  showCursor: `${csi}?25h`,
  clear: `${csi}2J${csi}H`,
  home: `${csi}H`,
  clearLine: `${csi}2K`
};

/**
 * Styling is opt-in and degrades to plain text.
 *
 * Terminals that set NO_COLOR, or that are not a TTY at all, get no escape
 * sequences, which is also what makes the renderer's output directly assertable
 * in tests.
 */
export function styling(enabled: boolean) {
  const wrap = (code: string) => (text: string) =>
    enabled ? `${csi}${code}m${text}${csi}0m` : text;
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    inverse: wrap("7"),
    accent: wrap("36"),
    warn: wrap("33"),
    danger: wrap("31")
  };
}

export type Styles = ReturnType<typeof styling>;

export function colorEnabled(stream: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  return stream.isTTY === true;
}
