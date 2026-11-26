// Format code colors. `[Color1]` to `[Color56]` are the legacy indexed colors 8 to 63 of ECMA-376 Part 1, 18.8.27.
// The eight names are the first eight of them. A render returns a token, and the grid draws it through a theme token
// so `[Red]` keeps its contrast in dark mode (DIFFERENCES.md).

export const COLOR_NAMES = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'magenta', 'cyan'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/** Indexed colors 8 to 63, so entry 0 is `[Color1]`. */
const INDEXED = (
  '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 ' +
  '9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF ' +
  '00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 ' +
  '003366 339966 003300 333300 993300 993366 333399 333333'
).split(' ');

/** The token of a bracket's text (`Red`, `color12`), or null when it is not a color. */
export function colorToken(text: string): string | null {
  const lower = text.toLowerCase();
  if ((COLOR_NAMES as readonly string[]).includes(lower)) return lower;
  const m = /^color(\d{1,2})$/.exec(lower);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 56 ? `color${n}` : null;
}

/** The RGB hex of a color token, such as "FF0000" for `red`, or null for an unknown token. */
export function colorRgb(token: string): string | null {
  const named = (COLOR_NAMES as readonly string[]).indexOf(token);
  if (named >= 0) return INDEXED[named];
  const m = /^color(\d{1,2})$/.exec(token);
  return m ? (INDEXED[Number(m[1]) - 1] ?? null) : null;
}
