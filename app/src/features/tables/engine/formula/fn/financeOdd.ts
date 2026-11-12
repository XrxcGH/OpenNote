// Bonds with an odd first or last period. Owner: tables:fn-finance. An odd period is cut into quasi-coupon
// periods: the regular periods it would hold if coupons ran on the usual dates. For each one:
// - DC counts its days inside the odd period,
// - NL is its normal length,
// - A counts its days accrued by settlement.
//
// The documented formulas, with cpn = 100 rate / f and v = 1 + yld / f, follow.
//
//   last:  price = (red + cpn * sum DC/NL) / (1 + sum DSC/NL * yld/f) - cpn * sum A/NL.
//   first: price = red / v^(N+Nq+DSC/E) + cpn * sum DC/NL / v^(Nq+DSC/E) + sum k=1..N cpn / v^(k+Nq+DSC/E)
//                  - cpn * sum A/NL.
//
// In the first-period form, N counts the regular coupons after the first one. Nq counts the whole quasi-coupon
// periods between settlement's next quasi-coupon date and the first coupon. DSC is the days from settlement to that
// date, and E the normal length of settlement's quasi-coupon period. A short first period has one such period.

import { err, type FormulaError, type Value } from '../../values';
import { coupons, dayCount, periodDays, shiftMonths, type Basis } from './daycount';
import { basisArg, day, discountSum, done, frequencyArg, nums, solveRate, type Run } from './financeKit';

const isError = (v: unknown): v is FormulaError => typeof v === 'object' && v !== null && 'error' in v;

interface Odd {
  settle: number;
  maturity: number;
  /** issue for a first period, last_interest for a last one */
  edge: number;
  /** the first coupon date (first period only) */
  first: number;
  rate: number;
  x: number;
  red: number;
  f: 1 | 2 | 4;
  basis: Basis;
}

/** Reads settlement, maturity, the period's dates, rate, yld, or pr, redemption, frequency, [basis]. */
function oddArgs(args: Value[], firstPeriod: boolean): Odd | FormulaError {
  const dates = firstPeriod ? 4 : 3;
  const n = nums(
    args,
    Array.from({ length: dates + 5 }, () => 0),
  );
  if (!Array.isArray(n)) return n;
  const settle = day(n[0]);
  const maturity = day(n[1]);
  const edge = day(n[2]);
  const first = firstPeriod ? day(n[3]) : 0;
  const [rate, x, red] = n.slice(dates, dates + 3);
  const f = frequencyArg(n[dates + 3]);
  if (typeof f !== 'number') return f;
  const basis = basisArg(n[dates + 4]);
  if (typeof basis !== 'number') return basis;
  if (settle === null || maturity === null || edge === null || first === null) return err('NUM');
  if (rate < 0 || x < 0 || red <= 0) return err('NUM');
  if (firstPeriod ? !(maturity > first && first > settle && settle > edge) : !(maturity > settle && settle > edge)) {
    return err('NUM');
  }
  // With an odd first period, the regular coupons run from the first coupon to maturity, so maturity must fall on
  // that schedule: whole coupon periods after the first coupon.
  if (firstPeriod && coupons(first, maturity, f).pcd !== first) return err('NUM');
  return { settle, maturity, edge, first, rate, x, red, f, basis };
}

/** Over the quasi-coupon periods, the shares counted (DC/NL), accrued by settlement (A/NL) and left after it (DSC/NL). */
function sums(o: Odd, periods: readonly [number, number][], from: number, to: number) {
  let dc = 0;
  let accrued = 0;
  let left = 0;
  for (const [start, end] of periods) {
    const nl = periodDays(start, end, o.basis, o.f);
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (b <= a) continue;
    const counted = dayCount(a, b, o.basis);
    const gone = o.settle > a ? dayCount(a, Math.min(o.settle, b), o.basis) : 0;
    dc += counted / nl;
    accrued += gone / nl;
    left += (counted - gone) / nl;
  }
  return { dc, accrued, left };
}

/** The quasi-coupon periods of an odd last period, stepping forward from the last interest date past maturity. */
function lastPeriods(o: Odd): [number, number][] {
  const step = 12 / o.f;
  const out: [number, number][] = [];
  for (let i = 0; ; i++) {
    const start = shiftMonths(o.edge, i * step);
    if (start >= o.maturity) break;
    out.push([start, shiftMonths(o.edge, (i + 1) * step)]);
  }
  return out;
}

function oddLastPrice(o: Odd, yld: number): number {
  const s = sums(o, lastPeriods(o), o.edge, o.maturity);
  const cpn = (100 * o.rate) / o.f;
  return (o.red + cpn * s.dc) / (1 + (s.left * yld) / o.f) - cpn * s.accrued;
}

const ODDLPRICE: Run = (args) => {
  const o = oddArgs(args, false);
  return isError(o) ? o : done(oddLastPrice(o, o.x));
};

const ODDLYIELD: Run = (args) => {
  const o = oddArgs(args, false);
  if (isError(o)) return o;
  if (o.x <= 0) return err('NUM');
  // The last-period price is linear in 1 / (1 + ...), so the yield has a closed form.
  const s = sums(o, lastPeriods(o), o.edge, o.maturity);
  const cpn = (100 * o.rate) / o.f;
  const paid = o.x + cpn * s.accrued;
  return done(((o.red + cpn * s.dc - paid) / paid) * (o.f / s.left));
};

/**
 * The price of a bond with an odd first period, as a function of the yield. Nothing in the schedule depends on the
 * yield, so the periods and their sums are worked out once here, and each call of the function is a few steps. The
 * yield solver calls it many times.
 */
function oddFirstPricer(o: Odd): (yld: number) => number {
  const step = 12 / o.f;
  // Quasi-coupon periods back from the first coupon until one holds the issue date; the last in time comes first.
  const periods: [number, number][] = [];
  for (let j = 1; ; j++) {
    const start = shiftMonths(o.first, -j * step);
    periods.push([start, shiftMonths(o.first, -(j - 1) * step)]);
    if (start <= o.edge) break;
  }
  const s = sums(o, periods, o.edge, o.first);
  // The quasi-coupon period that holds settlement, counted back from the first coupon (1 is the one ending on it).
  const at = periods.findIndex(([start, end]) => start <= o.settle && o.settle < end);
  const [start, end] = periods[at];
  const e = periodDays(start, end, o.basis, o.f);
  const dsc = o.basis === 0 || o.basis === 4 ? e - dayCount(start, o.settle, o.basis) : end - o.settle;
  const nq = at;
  const regular = o.maturity > o.first ? coupons(o.first, o.maturity, o.f).count : 0;
  const cpn = (100 * o.rate) / o.f;
  const x = nq + dsc / e;
  return (yld) => {
    const v = 1 + yld / o.f;
    const ahead = Math.pow(v, -x);
    // The regular coupons, k = 1 to N, discounted by v^(k+x), are cpn v^-x times a geometric sum.
    const price = o.red / Math.pow(v, regular + x) + cpn * s.dc * ahead + cpn * ahead * discountSum(yld / o.f, regular);
    return price - cpn * s.accrued;
  };
}

const ODDFPRICE: Run = (args) => {
  const o = oddArgs(args, true);
  return isError(o) ? o : done(oddFirstPricer(o)(o.x));
};

const ODDFYIELD: Run = (args) => {
  const o = oddArgs(args, true);
  if (isError(o)) return o;
  if (o.x <= 0) return err('NUM');
  const price = oddFirstPricer(o);
  const y = solveRate((r) => price(r) - o.x, 0.1, -o.f);
  return y === null ? err('NUM') : done(y);
};

export const runs: Readonly<Record<string, Run>> = { ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD };
