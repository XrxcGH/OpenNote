// The shared value grammars of format spec Appendix D that cell styles use: numbers on a step, font names, the
// underline styles, and colors. NEXT-PLAN section 3.2 puts the one implementation in editor/schema/constants.ts,
// owned by text:md-inline-v2. Until that lane merges, the sheet model keeps this copy with the same names, and the
// lane that merges second points the imports at constants.ts.

export const PEN_COLORS = ['ink', 'indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'] as const;
export const HIGHLIGHTER_COLORS = ['honey', 'mint', 'rose', 'apricot', 'lilac'] as const;
export const THEME_COLORS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'text', 'background'];
export const THEME_FONTS = ['+body', '+heading', '+mono'] as const;

/** The 17 OOXML ST_Underline values other than `none` (R-VAL-5). */
export const UNDERLINE_STYLES = [
  'single',
  'double',
  'words',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
] as const;
export const ACCOUNTING_UNDERLINES = ['singleAccounting', 'doubleAccounting'] as const;

/** An element ID of spec 2.4: 26 lowercase Crockford base-32 characters, the first from 0 to 7. */
export const ELEMENT_ID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const HEX = /^#[0-9a-f]{6}$/;

/** A color of R-VAL-7: a pen or highlighter name, lowercase `#rrggbb`, or `theme:NAME`. */
export function isColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if ((PEN_COLORS as readonly string[]).includes(value)) return true;
  if ((HIGHLIGHTER_COLORS as readonly string[]).includes(value)) return true;
  if (HEX.test(value)) return true;
  return value.startsWith('theme:') && THEME_COLORS.includes(value.slice(6));
}

/** A font name or a theme token (R-VAL-2). */
export function isFontName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if ((THEME_FONTS as readonly string[]).includes(value)) return true;
  const chars = [...value];
  if (chars.length < 1 || chars.length > 63 || value.endsWith(' ')) return false;
  const letterOrDigit = (c: string) => /^[\p{L}\p{N}]$/u.test(c);
  return letterOrDigit(chars[0]) && chars.slice(1).every((c) => letterOrDigit(c) || ' ._+-'.includes(c));
}

/** A decimal as an integer mantissa and a power of ten, so steps compare exactly (R-NUM-1). */
function decimal(text: string): { m: bigint; e: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const m = BigInt(`${match[1]}${match[2]}${fraction}`);
  return { m, e: Number(match[4] ?? 0) - fraction.length };
}

/** Scales two decimals to one exponent. */
function align(a: { m: bigint; e: number }, b: { m: bigint; e: number }): [bigint, bigint] {
  const e = Math.min(a.e, b.e);
  return [a.m * 10n ** BigInt(a.e - e), b.m * 10n ** BigInt(b.e - e)];
}

/** A JSON number in `lo` to `hi` and a whole multiple of `step`, in exact decimal arithmetic (R-VAL-1). */
export function onStep(value: unknown, lo: number, hi: number, step: string): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) return false;
  const v = decimal(String(value));
  const s = decimal(step);
  if (!v || !s || s.m === 0n) return false;
  const [x, y] = align(v, s);
  return x % y === 0n;
}

export function isInteger(value: unknown, lo: number, hi: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
}
