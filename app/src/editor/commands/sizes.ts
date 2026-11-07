// Font sizes in points (owner: text:editor-commands). A size mark holds a version 1 name or points from 1 to 1638 in
// steps of 0.5 (R-MRK-2). Grow and shrink follow Word's preset list (text DESIGN.md 4.1); plus and minus 1 point
// clamp to the range. The functions are pure, so the commands, the size box, and tests share them.
import { SIZE_POINTS, isNumberText } from '../schema/constants';

export const MIN_POINTS = SIZE_POINTS.min;
export const MAX_POINTS = SIZE_POINTS.max;

/** The size of text without a size mark, at the default body style. */
export const BODY_POINTS = 12;

/** The version 1 names at the default 12 pt body. */
const NAMED_POINTS: Readonly<Record<string, number>> = { small: 10, large: 15, xlarge: 18 };

/** Word's preset sizes. Above the last, sizes go up by 10 to 1630, then to 1638. Below the first, by 1 to 1. */
export const PRESET_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const FIRST = PRESET_SIZES[0];
const LAST = PRESET_SIZES[PRESET_SIZES.length - 1];
/** The last multiple of 10 under the maximum. */
const LAST_TEN = Math.floor((MAX_POINTS - 1) / 10) * 10;

/** Every size grow and shrink can land on, in order. */
const LADDER: readonly number[] = (() => {
  const below = Array.from({ length: FIRST - MIN_POINTS }, (_, i) => MIN_POINTS + i);
  const above: number[] = [];
  for (let size = LAST + 10 - (LAST % 10); size <= LAST_TEN; size += 10) above.push(size);
  return [...below, ...PRESET_SIZES, ...above, MAX_POINTS];
})();

/** Points from a size mark's value (or null for no mark), or null when the value is not a size. */
export function pointsOf(size: string | null | undefined, body = BODY_POINTS): number | null {
  if (size === null || size === undefined) return body;
  if (Object.hasOwn(NAMED_POINTS, size)) return NAMED_POINTS[size];
  return isNumberText(size, SIZE_POINTS) ? Number(size) : null;
}

/** A number of points as a size mark writes it: rounded to the 0.5 grid, clamped, without trailing zeros. */
export function sizeText(points: number): string {
  const clamped = Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(points * 2) / 2));
  return String(clamped);
}

/** Whether text typed in the size box is a size: a number from 1 to 1638 on the 0.5 grid. */
export function parseSizeInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= MIN_POINTS && value <= MAX_POINTS && Number.isInteger(value * 2) ? value : null;
}

/** The next size on Word's list in a direction. A size between two entries moves to the next one that way. */
export function stepSize(points: number, direction: 1 | -1): number {
  if (direction > 0) return LADDER.find((size) => size > points) ?? MAX_POINTS;
  for (let i = LADDER.length - 1; i >= 0; i -= 1) if (LADDER[i] < points) return LADDER[i];
  return MIN_POINTS;
}

/** One point more or less. The result stays from 1 to 1638. */
export function nudgeSize(points: number, direction: 1 | -1): number {
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, points + direction));
}
