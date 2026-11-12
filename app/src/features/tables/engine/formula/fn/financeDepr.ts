// Depreciation. Owner: tables:fn-finance. Straight line (SLN), sum of years' digits (SYD), fixed declining balance
// (DB), declining balance (DDB, VDB), and the French accounting methods (AMORLINC, AMORDEGRC). Each follows the
// function's documented rule; the comments say the rule in our own words.

import { err, type Value } from '../../values';
import { yearFrac } from './daycount';
import { basisArg, day, done, flag, nums, type Run } from './financeKit';

const SLN: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [cost, salvage, life] = n;
  if (life === 0) return err('DIV0');
  return done((cost - salvage) / life);
};

const SYD: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [cost, salvage, life, per] = n;
  if (life <= 0 || per <= 0 || per > life) return err('NUM');
  return done(((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1)));
};

/** Fixed declining balance: a rate rounded to three places, a first year of `month` months, and a stub year after. */
const DB: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 12]);
  if (!Array.isArray(n)) return n;
  const [cost, salvage, life] = n;
  const period = Math.trunc(n[3]);
  const month = Math.trunc(n[4]);
  if (cost < 0 || salvage < 0 || life <= 0 || period < 1 || month < 1 || month > 12) return err('NUM');
  if (period > (month === 12 ? life : life + 1)) return err('NUM');
  if (cost === 0) return 0;
  const rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
  let total = (cost * rate * month) / 12;
  if (period === 1) return done(total);
  let dep = 0;
  for (let p = 2; p <= period; p++) {
    dep = (cost - total) * rate;
    if (p > life) dep = (dep * (12 - month)) / 12;
    total += dep;
  }
  return done(dep);
};

/** Book value left after `periods` periods of declining balance at `rate` a period (a closed form, so periods may be fractional). */
const bookAfter = (cost: number, rate: number, periods: number): number => cost * Math.pow(1 - rate, periods);

const DDB: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 2]);
  if (!Array.isArray(n)) return n;
  const [cost, salvage, life, period, factor] = n;
  if (cost < 0 || salvage < 0 || life <= 0 || period <= 0 || factor <= 0 || period > life) return err('NUM');
  const rate = Math.min(1, factor / life);
  const before = bookAfter(cost, rate, period - 1);
  // Never below the salvage value.
  return done(Math.min(before * rate, Math.max(0, before - salvage)));
};

/**
 * Declining balance between two points of the life, switching to straight line on the value left once that gives
 * more (unless no_switch). Each whole period's amount is worked in turn; a partial period at either end counts the
 * share of its period that lies inside the span.
 */
const VDB: Run = (args) => {
  const n = nums(args.slice(0, 6), [0, 0, 0, 0, 0, 2]);
  if (!Array.isArray(n)) return n;
  const noSwitch = flag(args, 6, false);
  if (typeof noSwitch !== 'boolean') return noSwitch;
  const [cost, salvage, life, start, end, factor] = n;
  if (cost < 0 || salvage < 0 || life <= 0 || start < 0 || end < start || end > life || factor <= 0) {
    return err('NUM');
  }
  const rate = Math.min(1, factor / life);
  let book = cost;
  let total = 0;
  const last = Math.ceil(end);
  for (let k = 1; k <= last; k++) {
    const left = Math.max(0, book - salvage);
    let amount = Math.min(book * rate, left);
    const remaining = life - (k - 1);
    if (!noSwitch) {
      const straight = remaining <= 1 ? left : left / remaining;
      if (straight > amount) amount = straight;
    }
    const share = Math.max(0, Math.min(end, k) - Math.max(start, k - 1));
    total += amount * share;
    book -= amount;
  }
  return done(total);
};

/** The checked arguments of AMORLINC and AMORDEGRC. Basis 2 (actual/360) is not one of their bases. */
function amorArgs(
  args: Value[],
):
  { cost: number; bought: number; first: number; salvage: number; period: number; rate: number; frac: number } | Value {
  const n = nums(args, [0, 0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const [cost, , , salvage, , rate] = n;
  const bought = day(n[1]);
  const first = day(n[2]);
  const period = Math.trunc(n[4]);
  const basis = basisArg(n[6]);
  if (typeof basis !== 'number' || basis === 2) return err('NUM');
  if (bought === null || first === null || bought > first) return err('NUM');
  if (cost <= 0 || salvage < 0 || salvage > cost || rate <= 0 || period < 0) return err('NUM');
  return { cost, bought, first, salvage, period, rate, frac: yearFrac(bought, first, basis) };
}

/** Linear: the first period's share of a year at the rate, then full years, then what is left above salvage. */
const AMORLINC: Run = (args) => {
  const a = amorArgs(args);
  if (!isAmor(a)) return a;
  const yearly = a.cost * a.rate;
  const firstPart = a.frac * yearly;
  if (a.period === 0) return done(Math.min(firstPart, a.cost - a.salvage));
  const full = Math.floor((a.cost - a.salvage - firstPart) / yearly);
  if (a.period <= full) return done(yearly);
  if (a.period === full + 1) return done(Math.max(0, a.cost - a.salvage - firstPart - full * yearly));
  return 0;
};

/**
 * Degressive: the rate grows by a coefficient set by the life (1/rate): 1.5 for 3 to 4 years, 2 for 5 to 6, 2.5 past 6;
 * other lives are #NUM!. Amounts round to whole units. When an amount would take the value below salvage, that
 * period takes half the value left and later periods nothing.
 */
const AMORDEGRC: Run = (args) => {
  const a = amorArgs(args);
  if (!isAmor(a)) return a;
  const life = 1 / a.rate;
  const near = (x: number): boolean => Math.abs(life - x) < 1e-9;
  let coefficient: number;
  if ((life >= 3 || near(3)) && (life <= 4 || near(4))) coefficient = 1.5;
  else if ((life >= 5 || near(5)) && (life <= 6 || near(6))) coefficient = 2;
  else if (life > 6) coefficient = 2.5;
  else return err('NUM');
  const rate = a.rate * coefficient;
  const firstPart = Math.round(a.frac * rate * a.cost);
  if (a.period === 0) return firstPart;
  let value = a.cost - firstPart;
  let rest = value - a.salvage;
  for (let k = 1; k <= a.period; k++) {
    const amount = Math.round(rate * value);
    rest -= amount;
    if (rest < 0) return k === a.period ? Math.round(value * 0.5) : 0;
    if (k === a.period) return amount;
    value -= amount;
  }
  return 0;
};

function isAmor(a: ReturnType<typeof amorArgs>): a is Exclude<ReturnType<typeof amorArgs>, Value> {
  return typeof a === 'object' && a !== null && 'frac' in a;
}

export const runs: Readonly<Record<string, Run>> = { SLN, SYD, DB, DDB, VDB, AMORLINC, AMORDEGRC };
