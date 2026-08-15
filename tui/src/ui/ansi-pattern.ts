const ESC = "\u001b";
const BEL = "\u0007";

/**
 * Every escape sequence this client emits: CSI for styling and cursor control,
 * OSC for the iTerm2 image protocol, APC for the kitty one.
 *
 * Built from escaped code points rather than written as a literal so the source
 * file carries no raw control bytes.
 */
export function ansiPattern(): RegExp {
  const csi = `${ESC}\\[[0-9;?]*[A-Za-z]`;
  const osc = `${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`;
  const apc = `${ESC}_[\\s\\S]*?${ESC}\\\\`;
  return new RegExp(`${csi}|${osc}|${apc}`, "g");
}
