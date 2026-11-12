// Financial functions. Owner: tables:fn-finance. This file holds only what the core chunk needs: each function's
// name, arguments, and example, so formulas compile and autocomplete knows them. The code that calculates lives in the
// financial chunk (lazy/financial.ts), loaded the first time a formula calls one of these functions. Until it lands
// such a formula shows #BUSY! ("Still calculating"); then every listener is told, so pages calculate again.

import { err } from '../../values';
import type { Run } from './financeKit';
import type { FnSpec2, Param, ParamGroup } from './types';

let runs: Readonly<Record<string, Run>> | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Loads the financial chunk once. Later calls give the same promise. A failed load may be tried again. */
export function loadFinance(): Promise<void> {
  pending ??= import('./lazy/financial').then(
    (chunk) => {
      runs = chunk.runs;
      for (const listener of [...listeners]) listener();
    },
    (cause: unknown) => {
      pending = null;
      throw cause;
    },
  );
  return pending;
}

/** True once the financial chunk has loaded. */
export const financeLoaded = (): boolean => runs !== null;

/** Calls `listener` when the chunk lands, so a page can recalculate. Returns a function that stops listening. */
export function onFinanceLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A run that waits for the chunk: #BUSY! until it has loaded, then the chunk's function by this name. */
function lazyRun(name: string): Run {
  return (args, env) => {
    if (runs === null) {
      loadFinance().catch(() => undefined);
      return err('BUSY');
    }
    const run = runs[name];
    return run === undefined ? err('NAME') : run(args, env);
  };
}

/**
 * A spec from a short list of arguments: "[name]" is optional, "name:range" takes a range or array, "name:bool" a
 * logical, and a last "name..." repeats as a range, at least once.
 */
function spec(name: string, list: string, example: string): FnSpec2 {
  const params: (Param | ParamGroup)[] = [];
  const shown: string[] = [];
  for (const word of list.split(' ').filter(Boolean)) {
    const optional = word.startsWith('[');
    const bare = optional ? word.slice(1, -1) : word;
    if (bare.endsWith('...')) {
      const base = bare.slice(0, -3);
      params.push({ repeat: [{ name: base, kind: 'range' }], min: 1 });
      shown.push(`${base}1`, '...');
      continue;
    }
    const [argName, kind] = bare.split(':');
    const param: Param = {
      name: argName,
      kind: kind === 'range' ? 'range' : kind === 'bool' ? 'bool' : 'number',
      ...(optional ? { optional: true } : {}),
    };
    params.push(param);
    shown.push(optional ? `[${argName}]` : argName);
  }
  return {
    name,
    family: 'finance',
    params,
    run: lazyRun(name),
    meta: { signature: `${name}(${shown.join(', ')})`, example },
  };
}

const COUPON = 'settlement maturity frequency [basis]';
const AMOR = 'cost date_purchased first_period salvage period rate [basis]';

export const functions: readonly FnSpec2[] = [
  spec(
    'ACCRINT',
    'issue first_interest settlement rate par frequency [basis] [calc_method:bool]',
    '=ACCRINT(DATE(2024,1,1),DATE(2024,7,1),DATE(2024,4,1),0.06,1000,2,0) gives 15',
  ),
  spec(
    'ACCRINTM',
    'issue settlement rate par [basis]',
    '=ACCRINTM(DATE(2024,1,1),DATE(2024,7,1),0.06,1000,0) gives 30',
  ),
  spec('AMORDEGRC', AMOR, '=AMORDEGRC(1000,DATE(2024,1,1),DATE(2024,12,31),100,1,0.25,0) gives 234'),
  spec('AMORLINC', AMOR, '=AMORLINC(1000,DATE(2024,1,1),DATE(2024,12,31),100,1,0.25,0) gives 250'),
  spec('COUPDAYBS', COUPON, '=COUPDAYBS(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 46'),
  spec('COUPDAYS', COUPON, '=COUPDAYS(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 182'),
  spec('COUPDAYSNC', COUPON, '=COUPDAYSNC(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 136'),
  spec('COUPNCD', COUPON, '=COUPNCD(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 45488, July 15, 2024'),
  spec('COUPNUM', COUPON, '=COUPNUM(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 12'),
  spec('COUPPCD', COUPON, '=COUPPCD(DATE(2024,3,1),DATE(2030,1,15),2,1) gives 45306, January 15, 2024'),
  spec('CUMIPMT', 'rate nper pv start_period end_period type', '=CUMIPMT(0.01,12,1000,1,1,0) gives -10'),
  spec('CUMPRINC', 'rate nper pv start_period end_period type', '=CUMPRINC(0.01,12,1000,1,1,0) gives -78.85'),
  spec('DB', 'cost salvage life period [month]', '=DB(1000,100,5,1) gives 369'),
  spec('DDB', 'cost salvage life period [factor]', '=DDB(1000,100,5,1) gives 400'),
  spec('DISC', 'settlement maturity pr redemption [basis]', '=DISC(DATE(2024,1,1),DATE(2024,7,1),98,100,0) gives 0.04'),
  spec('DOLLARDE', 'fractional_dollar fraction', '=DOLLARDE(1.02,16) gives 1.125'),
  spec('DOLLARFR', 'decimal_dollar fraction', '=DOLLARFR(1.125,16) gives 1.02'),
  spec(
    'DURATION',
    'settlement maturity coupon yld frequency [basis]',
    '=DURATION(DATE(2024,1,1),DATE(2026,1,1),0,0.05,1,0) gives 2',
  ),
  spec('EFFECT', 'nominal_rate npery', '=EFFECT(0.12,12) gives 0.1268'),
  spec('FV', 'rate nper pmt [pv] [type]', '=FV(0.1,2,-100) gives 210'),
  spec('FVSCHEDULE', 'principal schedule:range', '=FVSCHEDULE(100,{0.1,0.2}) gives 132'),
  spec(
    'INTRATE',
    'settlement maturity investment redemption [basis]',
    '=INTRATE(DATE(2024,1,1),DATE(2024,7,1),980,1000,0) gives 0.0408',
  ),
  spec('IPMT', 'rate per nper pv [fv] [type]', '=IPMT(0.1,1,3,1000) gives -100'),
  spec('IRR', 'values:range [guess]', '=IRR({-100,60,60}) gives 0.1307'),
  spec('ISPMT', 'rate per nper pv', '=ISPMT(0.1,1,4,1000) gives -75'),
  spec(
    'MDURATION',
    'settlement maturity coupon yld frequency [basis]',
    '=MDURATION(DATE(2024,1,1),DATE(2026,1,1),0,0.05,1,0) gives 1.9048',
  ),
  spec('MIRR', 'values:range finance_rate reinvest_rate', '=MIRR({-100,60,60},0.1,0.1) gives 0.1225'),
  spec('NOMINAL', 'effect_rate npery', '=NOMINAL(0.1268,12) gives 0.12'),
  spec('NPER', 'rate pmt pv [fv] [type]', '=NPER(0,-100,1000) gives 10'),
  spec('NPV', 'rate value...', '=NPV(0.1,110,121) gives 200'),
  spec(
    'ODDFPRICE',
    'settlement maturity issue first_coupon rate yld redemption frequency [basis]',
    '=ODDFPRICE(DATE(2024,2,1),DATE(2030,7,1),DATE(2024,1,1),DATE(2024,7,1),0.05,0.05,100,2,0) gives 99.9957',
  ),
  spec(
    'ODDFYIELD',
    'settlement maturity issue first_coupon rate pr redemption frequency [basis]',
    '=ODDFYIELD(DATE(2024,2,1),DATE(2030,7,1),DATE(2024,1,1),DATE(2024,7,1),0.05,99.9957,100,2,0) gives 0.05',
  ),
  spec(
    'ODDLPRICE',
    'settlement maturity last_interest rate yld redemption frequency [basis]',
    '=ODDLPRICE(DATE(2024,2,1),DATE(2024,4,1),DATE(2024,1,1),0.06,0.06,100,2,0) gives 99.995',
  ),
  spec(
    'ODDLYIELD',
    'settlement maturity last_interest rate pr redemption frequency [basis]',
    '=ODDLYIELD(DATE(2024,2,1),DATE(2024,4,1),DATE(2024,1,1),0.06,99.995,100,2,0) gives 0.06',
  ),
  spec('PDURATION', 'rate pv fv', '=PDURATION(0.1,100,121) gives 2'),
  spec('PMT', 'rate nper pv [fv] [type]', '=PMT(0,10,1000) gives -100'),
  spec('PPMT', 'rate per nper pv [fv] [type]', '=PPMT(0,1,10,1000) gives -100'),
  spec(
    'PRICE',
    'settlement maturity rate yld redemption frequency [basis]',
    '=PRICE(DATE(2024,1,1),DATE(2030,1,1),0.05,0.05,100,2,0) gives 100',
  ),
  spec(
    'PRICEDISC',
    'settlement maturity discount redemption [basis]',
    '=PRICEDISC(DATE(2024,1,1),DATE(2024,7,1),0.04,100,0) gives 98',
  ),
  spec(
    'PRICEMAT',
    'settlement maturity issue rate yld [basis]',
    '=PRICEMAT(DATE(2024,1,1),DATE(2025,1,1),DATE(2024,1,1),0.05,0.05,0) gives 100',
  ),
  spec('PV', 'rate nper pmt [fv] [type]', '=PV(0.1,2,0,-121) gives 100'),
  spec('RATE', 'nper pmt pv [fv] [type] [guess]', '=RATE(2,0,-100,121) gives 0.1'),
  spec(
    'RECEIVED',
    'settlement maturity investment discount [basis]',
    '=RECEIVED(DATE(2024,1,1),DATE(2024,7,1),980,0.04,0) gives 1000',
  ),
  spec('RRI', 'nper pv fv', '=RRI(2,100,121) gives 0.1'),
  spec('SLN', 'cost salvage life', '=SLN(1000,100,5) gives 180'),
  spec('SYD', 'cost salvage life per', '=SYD(1000,100,5,1) gives 300'),
  spec('TBILLEQ', 'settlement maturity discount', '=TBILLEQ(DATE(2024,1,1),DATE(2024,4,1),0.04) gives 0.0410'),
  spec('TBILLPRICE', 'settlement maturity discount', '=TBILLPRICE(DATE(2024,1,1),DATE(2024,4,1),0.04) gives 98.99'),
  spec('TBILLYIELD', 'settlement maturity pr', '=TBILLYIELD(DATE(2024,1,1),DATE(2024,4,1),98.99) gives 0.0404'),
  spec('VDB', 'cost salvage life start_period end_period [factor] [no_switch:bool]', '=VDB(1000,100,5,0,2) gives 640'),
  spec('XIRR', 'values:range dates:range [guess]', '=XIRR({-100,110},{0,365}) gives 0.1'),
  spec('XNPV', 'rate values:range dates:range', '=XNPV(0.1,{-100,110},{0,365}) gives 0'),
  spec(
    'YIELD',
    'settlement maturity rate pr redemption frequency [basis]',
    '=YIELD(DATE(2024,1,1),DATE(2030,1,1),0.05,100,100,2,0) gives 0.05',
  ),
  spec(
    'YIELDDISC',
    'settlement maturity pr redemption [basis]',
    '=YIELDDISC(DATE(2024,1,1),DATE(2024,7,1),98,100,0) gives 0.0408',
  ),
  spec(
    'YIELDMAT',
    'settlement maturity issue rate pr [basis]',
    '=YIELDMAT(DATE(2024,1,1),DATE(2025,1,1),DATE(2024,1,1),0.05,100,0) gives 0.05',
  ),
];
