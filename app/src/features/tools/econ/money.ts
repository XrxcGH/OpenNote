// Time value of money, loans, projects, and depreciation as pure functions. Rates are fractions per period.
import { scanRoots } from './num';

export const fv = (present: number, rate: number, n: number): number => present * (1 + rate) ** n;

/** The rate that grows a present value into a future value over n periods. */
export function rateFor(present: number, future: number, n: number): number | null {
  if (!(present > 0) || !(future > 0) || !(n > 0)) return null;
  return (future / present) ** (1 / n) - 1;
}

/** The periods that grow a present value into a future value at a rate. */
export function periodsFor(present: number, future: number, rate: number): number | null {
  if (!(present > 0) || !(future > 0) || !(rate > -1) || rate === 0) return null;
  return Math.log(future / present) / Math.log(1 + rate);
}

/** Present value of n payments, the first one period away (ordinary) or now (due), growing at g each period. */
export function annuityPv(payment: number, rate: number, n: number, due = false, growth = 0): number {
  let value: number;
  if (Math.abs(rate - growth) < 1e-12) value = (payment * n) / (1 + rate);
  else value = (payment * (1 - ((1 + growth) / (1 + rate)) ** n)) / (rate - growth);
  return due ? value * (1 + rate) : value;
}

export const annuityFv = (payment: number, rate: number, n: number, due = false, growth = 0): number =>
  annuityPv(payment, rate, n, due, growth) * (1 + rate) ** n;

/** Present value of a payment that never ends, the first one period away; null unless the rate exceeds growth. */
export function perpetuity(payment: number, rate: number, growth = 0): number | null {
  return rate > growth ? payment / (rate - growth) : null;
}

/** The level payment that repays `amount` over n periods. */
export function loanPayment(amount: number, rate: number, n: number): number {
  return rate === 0 ? amount / n : (amount * rate) / (1 - (1 + rate) ** -n);
}

/** The effective annual rate of a nominal rate compounded m times a year; m = Infinity is continuous. */
export const effectiveRate = (nominal: number, m: number): number =>
  Number.isFinite(m) ? (1 + nominal / m) ** m - 1 : Math.exp(nominal) - 1;

/** The level deposit that grows to a target over n periods. */
export function sinkingDeposit(target: number, rate: number, n: number): number {
  return rate === 0 ? target / n : (target * rate) / ((1 + rate) ** n - 1);
}

export interface LoanRow {
  period: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/** The repayment schedule; an extra amount each period shortens the loan. */
export function schedule(amount: number, rate: number, n: number, extra = 0): { rows: LoanRow[]; interest: number } {
  const base = loanPayment(amount, rate, n);
  const rows: LoanRow[] = [];
  let balance = amount;
  let interest = 0;
  for (let period = 1; period <= n && balance > 1e-9; period += 1) {
    const due = balance * rate;
    const pay = Math.min(base + extra, balance + due);
    balance = Math.max(0, balance + due - pay);
    if (balance < 1e-7) balance = 0;
    interest += due;
    rows.push({ period, payment: pay, interest: due, principal: pay - due, balance });
  }
  return { rows, interest };
}

export function npv(rate: number, flows: readonly number[]): number {
  return flows.reduce((sum, flow, t) => sum + flow / (1 + rate) ** t, 0);
}

/** Every internal rate of return between -90% and 1000% that the cash flows have, smallest first. */
export function irrs(flows: readonly number[]): number[] {
  if (!(flows.some((x) => x > 0) && flows.some((x) => x < 0))) return [];
  const found = scanRoots((r) => npv(r, flows), -0.9, 10, 2000);
  return found.filter((r, i) => i === 0 || Math.abs(r - found[i - 1]) > 1e-9);
}

export function mirr(flows: readonly number[], finance: number, reinvest: number): number | null {
  const n = flows.length - 1;
  const gain = flows.reduce((s, x, t) => (x > 0 ? s + x * (1 + reinvest) ** (n - t) : s), 0);
  const cost = flows.reduce((s, x, t) => (x < 0 ? s - x / (1 + finance) ** t : s), 0);
  return gain > 0 && cost > 0 && n > 0 ? (gain / cost) ** (1 / n) - 1 : null;
}

/** Periods until cumulative flows reach zero (interpolated within the period), or null when they never do. */
export function payback(flows: readonly number[], rate = 0): number | null {
  let total = 0;
  for (let t = 0; t < flows.length; t += 1) {
    const flow = flows[t] / (1 + rate) ** t;
    if (t > 0 && total < 0 && total + flow >= 0) return t - 1 + -total / flow;
    total += flow;
    if (t === 0 && total >= 0) return 0;
  }
  return null;
}

/** Profitability index: the present value of the later flows over the first outlay. */
export function profitabilityIndex(rate: number, flows: readonly number[]): number | null {
  return flows[0] < 0 ? (npv(rate, flows) - flows[0]) / -flows[0] : null;
}

export type Method = 'straight' | 'declining' | 'double' | 'syd';

/** Depreciation for each year of a life. `factor` is the declining-balance multiple of the straight-line rate. */
export function depreciation(method: Method, cost: number, salvage: number, life: number, factor = 1.5): number[] {
  const out: number[] = [];
  let book = cost;
  for (let year = 1; year <= life; year += 1) {
    let d: number;
    if (method === 'straight') d = (cost - salvage) / life;
    else if (method === 'syd') d = ((cost - salvage) * (life - year + 1)) / ((life * (life + 1)) / 2);
    else d = (book * (method === 'double' ? 2 : factor)) / life;
    d = Math.max(0, Math.min(d, book - salvage));
    out.push(d);
    book -= d;
  }
  return out;
}

export type Convention = 'half' | 'q1' | 'q2' | 'q3' | 'q4';
const FIRST_YEAR: Record<Convention, number> = { half: 0.5, q1: 0.875, q2: 0.625, q3: 0.375, q4: 0.125 };

/** MACRS shares of cost by year for a recovery class: declining balance (200% for 3 to 10 years, 150% above) that
 * switches to straight line over the remaining life when that is larger, with the first-year convention. */
export function macrs(recovery: number, convention: Convention = 'half'): number[] {
  const factor = recovery <= 10 ? 2 : 1.5;
  const first = FIRST_YEAR[convention];
  const out: number[] = [];
  let book = 1;
  let remaining = recovery;
  for (let year = 1; book > 1e-12; year += 1) {
    const share = year === 1 ? first : 1;
    const d =
      remaining <= share ? book : Math.min(book, Math.max((book * factor) / recovery, book / remaining) * share);
    out.push(d);
    book -= d;
    remaining -= share;
  }
  return out;
}

export interface Property {
  capRate: number;
  dscr: number | null;
  cashOnCash: number | null;
}

export function property(noi: number, price: number, debtService: number, equity: number): Property {
  return {
    capRate: noi / price,
    dscr: debtService > 0 ? noi / debtService : null,
    cashOnCash: equity > 0 ? (noi - debtService) / equity : null,
  };
}

/** Incremental cost per unit of effect (a QALY, say), or null when the effect does not change. */
export function icer(costNew: number, costOld: number, effectNew: number, effectOld: number): number | null {
  const effect = effectNew - effectOld;
  return effect === 0 ? null : (costNew - costOld) / effect;
}

/** Net monetary benefit of new over old at a willingness to pay per unit of effect. */
export const netMonetaryBenefit = (
  costNew: number,
  costOld: number,
  effectNew: number,
  effectOld: number,
  willingness: number,
): number => willingness * (effectNew - effectOld) - (costNew - costOld);
