// The time value of money, cash flows, and rates. Owner: tables:fn-finance. Money paid out is negative and money
// received is positive. Every payment function rests on one balance equation, with q = (1 + rate)^nper:
//   pv * q + pmt * (1 + rate * type) * (q - 1) / rate + fv = 0      (rate not 0)
//   pv + pmt * nper + fv = 0                                         (rate 0)
// Written from that published equation and each function's documented rule.

import { err, isError, type FormulaError, type Value } from '../../values';
import { day, done, due, flowsOf, itemsOf, nums, solveRate, strictNumbers, type Run } from './financeKit';

/** The balance equation's left side. q - 1 comes from expm1, so rates near zero keep their digits. */
function balance(rate: number, nper: number, pmt: number, pv: number, fv: number, type: 0 | 1): number {
  if (rate === 0) return pv + pmt * nper + fv;
  const grown = Math.expm1(nper * Math.log1p(rate));
  return pv * (1 + grown) + (pmt * (1 + rate * type) * grown) / rate + fv;
}

export function fv(rate: number, nper: number, pmt: number, pv: number, type: 0 | 1): number {
  if (rate === 0) return -(pv + pmt * nper);
  const q = Math.pow(1 + rate, nper);
  return -(pv * q + (pmt * (1 + rate * type) * (q - 1)) / rate);
}

export function pmt(rate: number, nper: number, pv: number, fvalue: number, type: 0 | 1): number {
  if (rate === 0) return -(pv + fvalue) / nper;
  const q = Math.pow(1 + rate, nper);
  return -(rate * (fvalue + pv * q)) / ((1 + rate * type) * (q - 1));
}

/** The interest part of payment `per`. A payment at the start of period 1 holds no interest. */
export function ipmt(rate: number, per: number, nper: number, pv: number, fvalue: number, type: 0 | 1): number {
  if (type === 1 && per === 1) return 0;
  const payment = pmt(rate, nper, pv, fvalue, type);
  const before = fv(rate, per - 1, payment, pv, type);
  // With payments at the start, the interest paid in period `per` is the interest earned during the period before.
  return type === 1 ? (before * rate) / (1 + rate) : before * rate;
}

const PV: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const [rate, nper, payment, fvalue, t] = n;
  const type = due(t);
  if (rate === 0) return done(-(fvalue + payment * nper));
  const q = Math.pow(1 + rate, nper);
  return done(-(fvalue + (payment * (1 + rate * type) * (q - 1)) / rate) / q);
};

const FV: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  return done(fv(n[0], n[1], n[2], n[3], due(n[4])));
};

const PMT: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  if (n[1] === 0) return err('NUM');
  return done(pmt(n[0], n[1], n[2], n[3], due(n[4])));
};

const NPER: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const [rate, payment, pv, fvalue, t] = n;
  if (rate === 0) return payment === 0 ? err('NUM') : done(-(pv + fvalue) / payment);
  if (rate <= -1) return err('NUM');
  const lead = payment * (1 + rate * due(t));
  const ratio = (lead - fvalue * rate) / (lead + pv * rate);
  if (!(ratio > 0)) return err('NUM');
  return done(Math.log(ratio) / Math.log1p(rate));
};

const RATE: Run = (args) => {
  const n = nums(args, [0, 0, 0, 0, 0, 0.1]);
  if (!Array.isArray(n)) return n;
  const [nper, payment, pv, fvalue, t, guess] = n;
  if (nper <= 0) return err('NUM');
  const type = due(t);
  const r = solveRate((x) => balance(x, nper, payment, pv, fvalue, type), guess);
  return r === null ? err('NUM') : done(r);
};

/** IPMT and PPMT: the period must lie in 1 to nper. */
function perPayment(args: Value[], part: 'interest' | 'principal'): Value {
  const n = nums(args, [0, 0, 0, 0, 0, 0]);
  if (!Array.isArray(n)) return n;
  const [rate, per, nper, pv, fvalue, t] = n;
  if (per < 1 || per > nper || nper <= 0) return err('NUM');
  const type = due(t);
  const interest = ipmt(rate, per, nper, pv, fvalue, type);
  return done(part === 'interest' ? interest : pmt(rate, nper, pv, fvalue, type) - interest);
}

/** CUMIPMT and CUMPRINC: whole periods from start to end, every argument checked. */
function cumulative(args: Value[], part: 'interest' | 'principal'): Value {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [rate, nper, pv] = n;
  const start = Math.trunc(n[3]);
  const end = Math.trunc(n[4]);
  const t = Math.trunc(n[5]);
  if (rate <= 0 || nper <= 0 || pv <= 0) return err('NUM');
  if (start < 1 || end < 1 || start > end || end > nper || (t !== 0 && t !== 1)) return err('NUM');
  const type = t as 0 | 1;
  const payment = pmt(rate, nper, pv, 0, type);
  let sum = 0;
  for (let per = start; per <= end; per++) {
    const interest = ipmt(rate, per, nper, pv, 0, type);
    sum += part === 'interest' ? interest : payment - interest;
  }
  return done(sum);
}

const ISPMT: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [rate, per, nper, pv] = n;
  if (nper === 0) return err('DIV0');
  return done(pv * rate * (per / nper - 1));
};

/** The present value of flows one period apart, the first one period away. */
function npvOf(rate: number, flows: readonly number[], first = 1): number {
  let sum = 0;
  let factor = Math.pow(1 + rate, first);
  for (const v of flows) {
    sum += v / factor;
    factor *= 1 + rate;
  }
  return sum;
}

const NPV: Run = (args) => {
  const r = nums(args.slice(0, 1));
  if (!Array.isArray(r)) return r;
  const rate = r[0];
  if (rate === -1) return err('DIV0');
  const flows = flowsOf(args.slice(1));
  if (!Array.isArray(flows)) return flows;
  return done(npvOf(rate, flows));
};

/** True when the flows hold both a payment and a receipt, which a rate of return needs. */
const mixed = (flows: readonly number[]): boolean => flows.some((v) => v > 0) && flows.some((v) => v < 0);

const IRR: Run = (args) => {
  const flows = flowsOf(args.slice(0, 1));
  if (!Array.isArray(flows)) return flows;
  const g = nums(args.slice(1), [0.1]);
  if (!Array.isArray(g)) return g;
  if (!mixed(flows)) return err('NUM');
  const r = solveRate((x) => npvOf(x, flows, 0), g[0]);
  return r === null ? err('NUM') : done(r);
};

const MIRR: Run = (args) => {
  const flows = flowsOf(args.slice(0, 1));
  if (!Array.isArray(flows)) return flows;
  const n = nums(args.slice(1));
  if (!Array.isArray(n)) return n;
  const [financeRate, reinvestRate] = n;
  const count = flows.length;
  if (count < 2 || !mixed(flows)) return err('DIV0');
  // Receipts grow to the end at the reinvestment rate; payments are discounted to the start at the finance rate.
  let grown = 0;
  let cost = 0;
  flows.forEach((v, i) => {
    if (v > 0) grown += v * Math.pow(1 + reinvestRate, count - 1 - i);
    else cost += v / Math.pow(1 + financeRate, i);
  });
  return done(Math.pow(-grown / cost, 1 / (count - 1)) - 1);
};

/** The flows and their whole-day dates, checked: same count, valid dates, none before the first. */
function dated(valuesArg: Value, datesArg: Value): { flows: number[]; days: number[] } | FormulaError {
  const flows = strictNumbers(valuesArg);
  if (!Array.isArray(flows)) return flows;
  const raw = strictNumbers(datesArg);
  if (!Array.isArray(raw)) return raw;
  if (flows.length !== raw.length || flows.length === 0) return err('NUM');
  const days: number[] = [];
  for (const d of raw) {
    const whole = day(d);
    if (whole === null) return err('NUM');
    days.push(whole);
  }
  if (days.some((d) => d < days[0])) return err('NUM');
  return { flows, days };
}

/** The present value at the first date of flows on given dates, a year being 365 days. */
function xnpvOf(rate: number, flows: readonly number[], days: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < flows.length; i++) sum += flows[i] / Math.pow(1 + rate, (days[i] - days[0]) / 365);
  return sum;
}

const XNPV: Run = (args) => {
  const r = nums(args.slice(0, 1));
  if (!Array.isArray(r)) return r;
  const d = dated(args[1], args[2]);
  if ('error' in d) return d;
  if (r[0] <= -1) return err('NUM');
  return done(xnpvOf(r[0], d.flows, d.days));
};

const XIRR: Run = (args) => {
  const d = dated(args[0], args[1]);
  if ('error' in d) return d;
  const g = nums(args.slice(2), [0.1]);
  if (!Array.isArray(g)) return g;
  if (!mixed(d.flows) || g[0] <= -1) return err('NUM');
  const r = solveRate((x) => xnpvOf(x, d.flows, d.days), g[0]);
  return r === null ? err('NUM') : done(r);
};

const EFFECT: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const periods = Math.trunc(n[1]);
  if (n[0] <= 0 || periods < 1) return err('NUM');
  return done(Math.pow(1 + n[0] / periods, periods) - 1);
};

const NOMINAL: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const periods = Math.trunc(n[1]);
  if (n[0] <= 0 || periods < 1) return err('NUM');
  return done(periods * (Math.pow(1 + n[0], 1 / periods) - 1));
};

const FVSCHEDULE: Run = (args) => {
  const p = nums(args.slice(0, 1));
  if (!Array.isArray(p)) return p;
  let total = p[0];
  // A schedule of rates: empty cells count as 0, numbers as themselves, anything else is #VALUE!.
  for (const item of itemsOf(args[1])) {
    if (isError(item)) return item;
    if (item !== null && typeof item !== 'number') return err('VALUE');
    total *= 1 + (item ?? 0);
  }
  return done(total);
};

const PDURATION: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [rate, pv, fvalue] = n;
  if (rate <= 0 || pv <= 0 || fvalue <= 0) return err('NUM');
  return done((Math.log(fvalue) - Math.log(pv)) / Math.log1p(rate));
};

const RRI: Run = (args) => {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const [nper, pv, fvalue] = n;
  if (nper <= 0 || pv === 0) return err('NUM');
  return done(Math.pow(fvalue / pv, 1 / nper) - 1);
};

/** DOLLARDE and DOLLARFR: the fraction's denominator, truncated; below 0 is #NUM!, below 1 is #DIV/0!. */
function dollar(args: Value[], toDecimal: boolean): Value {
  const n = nums(args);
  if (!Array.isArray(n)) return n;
  const value = n[0];
  const fraction = Math.trunc(n[1]);
  if (fraction < 0) return err('NUM');
  if (fraction < 1) return err('DIV0');
  const scale = Math.pow(10, Math.ceil(Math.log10(fraction)));
  const whole = Math.trunc(value);
  // The part after the point, freed of the noise of subtraction at 12 digits.
  const part = Number((value - whole).toFixed(12));
  return done(whole + (toDecimal ? (part * scale) / fraction : (part * fraction) / scale));
}

export const runs: Readonly<Record<string, Run>> = {
  PV,
  FV,
  PMT,
  NPER,
  RATE,
  IPMT: (args) => perPayment(args, 'interest'),
  PPMT: (args) => perPayment(args, 'principal'),
  CUMIPMT: (args) => cumulative(args, 'interest'),
  CUMPRINC: (args) => cumulative(args, 'principal'),
  ISPMT,
  NPV,
  IRR,
  MIRR,
  XNPV,
  XIRR,
  EFFECT,
  NOMINAL,
  FVSCHEDULE,
  PDURATION,
  RRI,
  DOLLARDE: (args) => dollar(args, true),
  DOLLARFR: (args) => dollar(args, false),
};
