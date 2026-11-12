// Day-count bases and coupon dates for the financial functions. Owner: tables:fn-finance. The five bases are the
// published conventions: 0 is US (NASD) 30/360, 1 is actual/actual, 2 is actual/360, 3 is actual/365, and 4 is
// European 30/360. Coupon dates step back from the maturity date by whole months; when the maturity date is the last
// day of its month, every coupon date is the last day of its month too. Written from those rules, not from code.

import { daysToYmd, ymdToSerial } from '../../dates';

export type Basis = 0 | 1 | 2 | 3 | 4;

/** The basis a number names, truncated as the reference apps do, or null outside 0 to 4. */
export function basisOf(n: number): Basis | null {
  const b = Math.trunc(n);
  return b >= 0 && b <= 4 ? (b as Basis) : null;
}

/** The coupons a year a number names: 1, 2, or 4 after truncation, else null. */
export function frequencyOf(n: number): 1 | 2 | 4 | null {
  const f = Math.trunc(n);
  return f === 1 || f === 2 || f === 4 ? f : null;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days between two dates on twelve 30-day months: the US (NASD) method, or the European one. */
export function days360(s: number, e: number, european: boolean): number {
  const a = daysToYmd(s);
  const b = daysToYmd(e);
  let d1 = a.d;
  let d2 = b.d;
  if (european) {
    d1 = Math.min(d1, 30);
    d2 = Math.min(d2, 30);
  } else {
    const lastFeb = (x: { y: number; m: number; d: number }): boolean => x.m === 2 && x.d === daysInMonth(x.y, 2);
    if (lastFeb(a)) {
      if (lastFeb(b)) d2 = 30;
      d1 = 30;
    }
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}

/** Days from s to e as a basis counts them: 30/360 for bases 0 and 4, calendar days for the others. */
export function dayCount(s: number, e: number, basis: Basis): number {
  if (basis === 0) return days360(s, e, false);
  if (basis === 4) return days360(s, e, true);
  return e - s;
}

/** The fraction of a year from s to e (s <= e), as YEARFRAC counts it on each basis. */
export function yearFrac(s: number, e: number, basis: Basis): number {
  const days = e - s;
  switch (basis) {
    case 0:
      return days360(s, e, false) / 360;
    case 4:
      return days360(s, e, true) / 360;
    case 2:
      return days / 360;
    case 3:
      return days / 365;
    default: {
      const a = daysToYmd(s);
      const b = daysToYmd(e);
      if (a.y === b.y) return days / (isLeap(a.y) ? 366 : 365);
      const within = b.y === a.y + 1 && (b.m < a.m || (b.m === a.m && b.d <= a.d));
      if (within) {
        // Under a year apart across New Year: 366 when the span holds a February 29, else 365.
        const leapDay = (isLeap(a.y) && s <= ymdToSerial(a.y, 2, 29)) || (isLeap(b.y) && e >= ymdToSerial(b.y, 2, 29));
        return days / (leapDay ? 366 : 365);
      }
      let total = 0;
      for (let y = a.y; y <= b.y; y++) total += isLeap(y) ? 366 : 365;
      return days / (total / (b.y - a.y + 1));
    }
  }
}

/**
 * The date `months` whole months after an anchor date (before it when negative). The day is the anchor's, cut back
 * to the end of a shorter month; an anchor on the last day of its month lands on the last day of every month.
 */
export function shiftMonths(anchor: number, months: number): number {
  const a = daysToYmd(anchor);
  const index = a.y * 12 + (a.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  const last = daysInMonth(y, m);
  const day = a.d === daysInMonth(a.y, a.m) ? last : Math.min(a.d, last);
  return ymdToSerial(y, m, day);
}

/** The coupon dates around a settlement date: the one before or on it, the one after it, and how many remain. */
export interface Coupons {
  /** The coupon date on or before settlement. */
  readonly pcd: number;
  /** The first coupon date after settlement. */
  readonly ncd: number;
  /** Coupons payable after settlement, up to, and including maturity. */
  readonly count: number;
}

/** The coupon dates of a bond that matures on `maturity`, around `settle` (settle < maturity). */
export function coupons(settle: number, maturity: number, frequency: number): Coupons {
  const step = 12 / frequency;
  const s = daysToYmd(settle);
  const m = daysToYmd(maturity);
  const months = (m.y - s.y) * 12 + (m.m - s.m);
  // Start a little short of the answer, then walk back one coupon at a time.
  let k = Math.max(1, Math.floor(months / step) - 1);
  while (k > 1 && shiftMonths(maturity, -(k - 1) * step) <= settle) k -= 1;
  while (shiftMonths(maturity, -k * step) > settle) k += 1;
  return { pcd: shiftMonths(maturity, -k * step), ncd: shiftMonths(maturity, -(k - 1) * step), count: k };
}

/** The length in days of the coupon period from pcd to ncd, as the basis counts it. */
export function periodDays(pcd: number, ncd: number, basis: Basis, frequency: number): number {
  if (basis === 1) return ncd - pcd;
  return (basis === 3 ? 365 : 360) / frequency;
}

/** Days from the start of the coupon period to settlement (A), and from settlement to the next coupon (DSC). */
export function splitPeriod(
  settle: number,
  c: Coupons,
  basis: Basis,
  frequency: number,
): { a: number; dsc: number; e: number } {
  const e = periodDays(c.pcd, c.ncd, basis, frequency);
  const a = dayCount(c.pcd, settle, basis);
  // On 30/360 the days left are the period less the days gone, so the two always add up to the period.
  const dsc = basis === 0 || basis === 4 ? e - a : c.ncd - settle;
  return { a, dsc, e };
}
