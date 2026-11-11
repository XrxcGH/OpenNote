// Word's single line height as a factor of the font size (text DESIGN.md 6.5): (usWinAscent + usWinDescent +
// external leading) / unitsPerEm. CSS `line-height: normal` differs on each OS, so a line multiple is the multiple
// times this factor. The values are the fonts' own metrics, and a test reads them back from the bundled fonts.

/** The factor of a font Word users commonly have, by lowercase name, with its metric-identical stand-in. */
const KNOWN: Readonly<Record<string, number>> = {
  calibri: 2500 / 2048,
  carlito: 2500 / 2048,
  cambria: 2401 / 2048,
  // Caladea matches Cambria's advance widths but has taller line metrics of its own, so it keeps its own.
  caladea: 1300 / 1000,
  arial: 2355 / 2048,
  helvetica: 2355 / 2048,
  'liberation sans': 2355 / 2048,
  'times new roman': 2355 / 2048,
  'liberation serif': 2355 / 2048,
  'courier new': 2320 / 2048,
  'liberation mono': 2320 / 2048,
};

/** What a font gets when nothing is known about it. */
export const DEFAULT_LINE_FACTOR = 1.2;

const learned = new Map<string, number>();

/** Teaches the renderer a device font's factor, from `fonts_list` (a later lane calls this when the list loads). */
export function setLineFactor(fontName: string, factor: number): void {
  if (Number.isFinite(factor) && factor >= 0.8 && factor <= 3) learned.set(fontName.trim().toLowerCase(), factor);
}

/** The single-line factor of a font name. */
export function lineFactor(fontName: string | null): number {
  if (fontName === null) return DEFAULT_LINE_FACTOR;
  const key = fontName.trim().toLowerCase();
  return learned.get(key) ?? KNOWN[key] ?? DEFAULT_LINE_FACTOR;
}
