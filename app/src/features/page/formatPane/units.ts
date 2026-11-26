// Lengths typed in the Format pane (text DESIGN.md 5.3): a number with an optional unit, converted to points. A
// bare number is in the field's own unit. The result sits on the 0.05 point grid the paragraph keys use.

/** Points in one of each unit. A CSS pixel is 3/4 point; an inch is 72 points (the definition of a point). */
const POINTS: Readonly<Record<string, number>> = {
  pt: 1,
  px: 0.75,
  in: 72,
  '"': 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: 12,
};

export type LengthUnit = 'pt' | 'in' | 'cm' | 'mm' | 'px' | 'pc';

const PATTERN = /^\s*([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(pt|px|in|cm|mm|pc|")?\s*$/i;

/** Points for what was typed, such as `0.5in`, `1,5 cm`, or `12`; null when it is not a length. */
export function parseLength(text: string, bare: LengthUnit = 'pt'): number | null {
  const match = PATTERN.exec(text);
  if (match === null) return null;
  const raw = Number(match[1].replace(',', '.')) * POINTS[(match[2] ?? bare).toLowerCase()];
  return Math.round(raw * 20) / 20;
}

/** Points as text without trailing zeros: `36`, `10.5`. */
export function formatPoints(points: number): string {
  return String(Math.round(points * 100) / 100);
}

/** Points as text in a unit, such as 36 as `0.5 in`. Points stay plain numbers. */
export function formatLength(points: number, unit: LengthUnit = 'pt'): string {
  if (unit === 'pt') return formatPoints(points);
  return `${String(Math.round((points / POINTS[unit]) * 100) / 100)} ${unit}`;
}
