// The size box's rules (design section 5): free entry in points with a unit, 1 to 1638 in steps of 0.5.

/** Word's list of sizes. */
export const SIZE_LIST: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export const MIN_SIZE = 1;
export const MAX_SIZE = 1638;

/** Points in one of each unit. A CSS pixel is 3/4 point. */
const POINTS: Readonly<Record<string, number>> = {
  pt: 1,
  px: 0.75,
  in: 72,
  '"': 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  pc: 12,
};

export type SizeResult = { ok: true; points: number } | { ok: false; reason: 'range' | 'invalid' };

/** Reads what a person typed in the size box. The result is in points, rounded to the nearest half point. */
export function parseSize(text: string): SizeResult {
  const match = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*(pt|px|in|cm|mm|pc|")?\s*$/i.exec(text);
  if (match === null) return { ok: false, reason: 'invalid' };
  const raw = Number(match[1].replace(',', '.')) * POINTS[(match[2] ?? 'pt').toLowerCase()];
  const points = Math.round(raw * 2) / 2;
  return points < MIN_SIZE || points > MAX_SIZE ? { ok: false, reason: 'range' } : { ok: true, points };
}

/** The text for a size: no trailing zeros ("11", "10.5"). */
export function formatSize(points: number): string {
  return String(Math.round(points * 100) / 100);
}
