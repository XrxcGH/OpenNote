// Bonds, coupons, and discounted securities. Owner: tables:fn-finance. Prices are per 100 of face value.
// Coupon dates and day counts come from daycount.ts. A bond's price is the documented sum of its payments.
// Each coupon and the redemption is discounted at the yield per period for the time until it is paid.
//
//   price = red / v^(N-1+DSC/E) + sum over k of (100 rate / f) / v^(k-1+DSC/E) - (100 rate / f) A / E.
//
// Here v = 1 + yld/f, and N counts the coupons left. DSC is the days to the next coupon. E is the days of the
// period, and A the days gone.

import { daysToYmd, ymdToSerial } from '../../dates';
import { err, type FormulaError, type Value } from '../../values';
import { coupons, dayCount, daysInMonth, periodDays, shiftMonths, splitPeriod, yearFrac, type Basis } from './daycount';
import { basisArg, day, done, flag, frequencyArg, nums, solveRate, type Run } from './financeKit';

/** Settlement and maturity as whole days, settlement first. */
function span(s: number, m: number): { settle: number; maturity: number } | FormulaError {
  const settle = day(s);
  const maturity = day(m);
  if (settle === null || maturity === null || settle >= maturity) return err('NUM');
  return { settle, maturity };
}

const isError = (v: unknown): v is FormulaError => typeof v === 'object' && v !== null && 'error' in v;

/** The arguments every coupon function takes: settlement, maturity, frequency, [basis]. */
function couponArgs(args: Value[]): { settle: number; maturity: number; f: 1 | 2 | 4; basis: Basis } | FormulaError {
  const n = nums(args, [0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const f = frequencyArg(n[2]);
  if (typeof f !== 'number') return f;
  const basis = basisArg(n[3]);
  if (typeof basis !== 'number') return basis;
  return { ...s, f, basis };
}

function coupon(pick: (c: ReturnType<typeof coupons>, part: ReturnType<typeof splitPeriod>) => number): Run {
  return (args) => {
    const a = couponArgs(args);
    if (isError(a)) return a;
    const c = coupons(a.settle, a.maturity, a.f);
    return done(pick(c, splitPeriod(a.settle, c, a.basis, a.f)));
  };
}

/** The price per 100 of a bond, as the formula at the top of this file gives it. */
export function priceOf(
  settle: number,
  maturity: number,
  rate: number,
  yld: number,
  red: number,
  f: number,
  basis: Basis,
): number {
  const c = coupons(settle, maturity, f);
  const { a, dsc, e } = splitPeriod(settle, c, basis, f);
  const cpn = (100 * rate) / f;
  if (c.count === 1) return (red + cpn) / (1 + ((dsc / e) * yld) / f) - (cpn * a) / e;
  const v = 1 + yld / f;
  const x = dsc / e;
  let sum = red / Math.pow(v, c.count - 1 + x);
  for (let k = 1; k <= c.count; k++) sum += cpn / Math.pow(v, k - 1 + x);
  return sum - (cpn * a) / e;
}

/** The checked arguments of PRICE and YIELD: settlement, maturity, rate, yld, or pr, redemption, frequency, [basis]. */
function bondArgs(
  args: Value[],
):
  | { settle: number; maturity: number; rate: number; x: number; red: number; f: 1 | 2 | 4; basis: Basis }
  | FormulaError {
  const n = nums(args, [0, 0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const f = frequencyArg(n[5]);
  if (typeof f !== 'number') return f;
  const basis = basisArg(n[6]);
  if (typeof basis !== 'number') return basis;
  if (n[2] < 0 || n[3] < 0 || n[4] <= 0) return err('NUM');
  return { ...s, rate: n[2], x: n[3], red: n[4], f, basis };
}

const PRICE: Run = (args) => {
  const b = bondArgs(args);
  if (isError(b)) return b;
  return done(priceOf(b.settle, b.maturity, b.rate, b.x, b.red, b.f, b.basis));
};

const YIELD: Run = (args) => {
  const b = bondArgs(args);
  if (isError(b)) return b;
  if (b.x <= 0) return err('NUM');
  const c = coupons(b.settle, b.maturity, b.f);
  if (c.count === 1) {
    // One coupon left: the yield is simple interest on the money paid, so it has a closed form.
    const { a, dsc, e } = splitPeriod(b.settle, c, b.basis, b.f);
    const paid = b.x / 100 + ((a / e) * b.rate) / b.f;
    const got = b.red / 100 + b.rate / b.f;
    return done((((got - paid) / paid) * b.f * e) / dsc);
  }
  const y = solveRate((r) => priceOf(b.settle, b.maturity, b.rate, r, b.red, b.f, b.basis) - b.x, 0.1, -b.f);
  return y === null ? err('NUM') : done(y);
};

/** Macaulay duration in years: the time to each payment, weighted by its present value. */
function durationOf(args: Value[]): { years: number; yld: number; f: number } | FormulaError {
  const n = nums(args, [0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const f = frequencyArg(n[4]);
  if (typeof f !== 'number') return f;
  const basis = basisArg(n[5]);
  if (typeof basis !== 'number') return basis;
  const [, , rate, yld] = n;
  if (rate < 0 || yld < 0) return err('NUM');
  const c = coupons(s.settle, s.maturity, f);
  const { dsc, e } = splitPeriod(s.settle, c, basis, f);
  const v = 1 + yld / f;
  const cpn = (100 * rate) / f;
  let weighted = 0;
  let total = 0;
  for (let k = 1; k <= c.count; k++) {
    const t = k - 1 + dsc / e;
    const pv = (cpn + (k === c.count ? 100 : 0)) / Math.pow(v, t);
    weighted += t * pv;
    total += pv;
  }
  return { years: weighted / total / f, yld, f };
}

const DURATION: Run = (args) => {
  const d = durationOf(args);
  return isError(d) ? d : done(d.years);
};

const MDURATION: Run = (args) => {
  const d = durationOf(args);
  return isError(d) ? d : done(d.years / (1 + d.yld / d.f));
};

/**
 * Interest accrued on a bond that pays coupons, from issue (or, with calc_method FALSE once the first coupon has
 * passed, from the first coupon date) to settlement: each quasi-coupon period counts its share of a coupon.
 */
const ACCRINT: Run = (args) => {
  const n = nums(args.slice(0, 7), [0, 0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const fromIssue = flag(args, 7, true);
  if (typeof fromIssue !== 'boolean') return fromIssue;
  const issue = day(n[0]);
  const first = day(n[1]);
  const settle = day(n[2]);
  const [, , , rate, par] = n;
  const f = frequencyArg(n[5]);
  if (typeof f !== 'number') return f;
  const basis = basisArg(n[6]);
  if (typeof basis !== 'number') return basis;
  if (issue === null || first === null || settle === null || issue >= settle) return err('NUM');
  if (rate <= 0 || par <= 0) return err('NUM');
  const start = !fromIssue && settle > first ? first : issue;
  const step = 12 / f;
  // The quasi-coupon period holding the start, counted in periods from the first coupon date.
  let k = Math.floor(monthsBetween(first, start) / step) - 1;
  while (shiftMonths(first, (k + 1) * step) <= start) k += 1;
  while (shiftMonths(first, k * step) > start) k -= 1;
  let share = 0;
  for (; shiftMonths(first, k * step) < settle; k++) {
    const from = shiftMonths(first, k * step);
    const to = shiftMonths(first, (k + 1) * step);
    const a = Math.max(start, from);
    const b = Math.min(settle, to);
    if (b > a) share += dayCount(a, b, basis) / periodDays(from, to, basis, f);
  }
  return done(((par * rate) / f) * share);
};

/** Whole months from a to b, by calendar month. */
function monthsBetween(a: number, b: number): number {
  const x = daysToYmd(a);
  const y = daysToYmd(b);
  return (y.y - x.y) * 12 + (y.m - x.m);
}

/** The arguments of the functions that read settlement, maturity, two numbers and [basis]. */
function discountArgs(
  args: Value[],
): { settle: number; maturity: number; a: number; b: number; years: number } | FormulaError {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const basis = basisArg(n[4]);
  if (typeof basis !== 'number') return basis;
  if (n[2] <= 0 || n[3] <= 0) return err('NUM');
  return { ...s, a: n[2], b: n[3], years: yearFrac(s.settle, s.maturity, basis) };
}

const ACCRINTM: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const issue = day(n[0]);
  const settle = day(n[1]);
  const basis = basisArg(n[4]);
  if (typeof basis !== 'number') return basis;
  if (issue === null || settle === null || issue >= settle || n[2] <= 0 || n[3] <= 0) return err('NUM');
  return done(n[3] * n[2] * yearFrac(issue, settle, basis));
};

/** DISC: the discount rate that takes the redemption value down to the price. */
const DISC: Run = (args) => {
  const d = discountArgs(args);
  return isError(d) ? d : done((d.b - d.a) / d.b / d.years);
};

/** INTRATE: the interest rate that grows the investment to the redemption value. */
const INTRATE: Run = (args) => {
  const d = discountArgs(args);
  return isError(d) ? d : done((d.b - d.a) / d.a / d.years);
};

/** RECEIVED: what a fully invested discounted security pays at maturity. */
const RECEIVED: Run = (args) => {
  const d = discountArgs(args);
  if (isError(d)) return d;
  const left = 1 - d.b * d.years;
  return left <= 0 ? err('NUM') : done(d.a / left);
};

/** PRICEDISC: the price of a discounted security. */
const PRICEDISC: Run = (args) => {
  const d = discountArgs(args);
  return isError(d) ? d : done(d.b - d.a * d.b * d.years);
};

/** YIELDDISC: the yearly yield of a discounted security. */
const YIELDDISC: Run = (args) => {
  const d = discountArgs(args);
  return isError(d) ? d : done((d.b - d.a) / d.a / d.years);
};

/** PRICEMAT and YIELDMAT: settlement, maturity, issue, rate, yld, or pr, [basis]; interest is paid at maturity. */
function maturityArgs(args: Value[]): { dim: number; dsm: number; a: number; rate: number; x: number } | FormulaError {
  const n = nums(args, [0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const issue = day(n[2]);
  const basis = basisArg(n[5]);
  if (typeof basis !== 'number') return basis;
  if (issue === null || issue > s.settle || n[3] < 0 || n[4] < 0) return err('NUM');
  return {
    dim: yearFrac(issue, s.maturity, basis),
    dsm: yearFrac(s.settle, s.maturity, basis),
    a: yearFrac(issue, s.settle, basis),
    rate: n[3],
    x: n[4],
  };
}

const PRICEMAT: Run = (args) => {
  const m = maturityArgs(args);
  if (isError(m)) return m;
  return done((100 + m.dim * m.rate * 100) / (1 + m.dsm * m.x) - m.a * m.rate * 100);
};

const YIELDMAT: Run = (args) => {
  const m = maturityArgs(args);
  if (isError(m)) return m;
  if (m.x <= 0) return err('NUM');
  const paid = m.x / 100 + m.a * m.rate;
  return done((1 + m.dim * m.rate - paid) / paid / m.dsm);
};

/** Treasury bills: settlement before maturity, at most one calendar year apart; the days between. */
function billDays(args: Value[]): { days: number; x: number } | FormulaError {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const s = span(n[0], n[1]);
  if (isError(s)) return s;
  const d = daysToYmd(s.settle);
  const yearOn = ymdToSerial(d.y + 1, d.m, Math.min(d.d, daysInMonth(d.y + 1, d.m)));
  if (s.maturity > yearOn || n[2] <= 0) return err('NUM');
  return { days: s.maturity - s.settle, x: n[2] };
}

const TBILLPRICE: Run = (args) => {
  const b = billDays(args);
  if (isError(b)) return b;
  const price = 100 * (1 - (b.x * b.days) / 360);
  return price <= 0 ? err('NUM') : done(price);
};

const TBILLYIELD: Run = (args) => {
  const b = billDays(args);
  return isError(b) ? b : done(((100 - b.x) / b.x) * (360 / b.days));
};

const TBILLEQ: Run = (args) => {
  const b = billDays(args);
  if (isError(b)) return b;
  const below = 360 - b.x * b.days;
  return below <= 0 ? err('NUM') : done((365 * b.x) / below);
};

export const runs: Readonly<Record<string, Run>> = {
  COUPDAYBS: coupon((_c, p) => p.a),
  COUPDAYS: coupon((_c, p) => p.e),
  COUPDAYSNC: coupon((_c, p) => p.dsc),
  COUPNCD: coupon((c) => c.ncd),
  COUPPCD: coupon((c) => c.pcd),
  COUPNUM: coupon((c) => c.count),
  PRICE,
  YIELD,
  DURATION,
  MDURATION,
  ACCRINT,
  ACCRINTM,
  DISC,
  INTRATE,
  RECEIVED,
  PRICEDISC,
  YIELDDISC,
  PRICEMAT,
  YIELDMAT,
  TBILLPRICE,
  TBILLYIELD,
  TBILLEQ,
};
