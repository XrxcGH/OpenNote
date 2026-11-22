// Financial functions. Every expected value comes from fixtures/fn/finance.json: the lane's published known answers,
// published examples, or values worked by hand from each function's documented formula, never from this code's output.

import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/fn/finance.json';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import { ERROR_TOKENS, type Value } from '../../values';
import { fnFinance } from '../../../../../strings/en/fnFinance';
import { REGISTRY } from '.';
import { financeLoaded, functions, loadFinance, onFinanceLoaded } from './finance';

interface Case {
  formula: string;
  cells?: Record<string, number>;
  expected: number | string;
  tolerance?: number;
  kind?: 'boundary' | 'error' | 'arity';
  /** A case the timing test also runs: a span of dates wide enough to hold tens of thousands of coupons. */
  hostile?: boolean;
}

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name, type: 'number' as const }));
const ENV = { today: () => 45292 };

/** Types the cells, then the formula in F1, and returns F1's value. */
function run(formula: string, cells: Record<string, number> = {}): Value {
  const data = Array.from({ length: 8 }, () => ['', '', '', '', '', '']);
  let t = createTable(COLUMNS, data, EN_US, ENV, 1);
  for (const [ref, v] of Object.entries(cells)) {
    t = setCellInput(t, { row: Number(ref.slice(1)) - 1, col: ref.charCodeAt(0) - 65, raw: String(v) }, EN_US, ENV);
  }
  t = setCellInput(t, { row: 0, col: 5, raw: formula }, EN_US, ENV);
  return t.rows[0].cells[5].value;
}

const tokens = Object.values(ERROR_TOKENS);
const tokenOf = (v: Value): string | undefined =>
  typeof v === 'object' && v !== null && 'error' in v ? ERROR_TOKENS[v.error] : undefined;
const NAMES = functions.map((f) => f.name);

// Loading a chunk can take seconds when many test files run at once, so the load gets a long time limit.
describe('the financial chunk', () => {
  it('loads on first use: #BUSY! until it lands, then the answer', async () => {
    expect(financeLoaded()).toBe(false);
    let told = 0;
    const stop = onFinanceLoaded(() => (told += 1));
    expect(tokenOf(run('=PMT(0,10,1000)'))).toBe('#BUSY!');
    await loadFinance();
    stop();
    expect(told).toBe(1);
    expect(financeLoaded()).toBe(true);
    expect(run('=PMT(0,10,1000)')).toBe(-100);
  }, 60_000);
});

describe('financial functions (fixture cases)', () => {
  beforeAll(() => loadFinance(), 60_000);
  it.each((fixture.cases as Case[]).map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    const got = run(c.formula, c.cells);
    if (typeof c.expected === 'string' && tokens.includes(c.expected)) {
      expect(tokenOf(got)).toBe(c.expected);
    } else if (typeof c.expected === 'number' && c.tolerance !== undefined) {
      expect(typeof got).toBe('number');
      expect(Math.abs((got as number) - c.expected)).toBeLessThanOrEqual(
        c.tolerance * Math.max(1, Math.abs(c.expected)),
      );
    } else {
      expect(got).toBe(c.expected);
    }
  });

  it('gives every function five cases or more, with a boundary, an error and an argument-count case', () => {
    const cases = fixture.cases as Case[];
    for (const name of NAMES) {
      const own = cases.filter((c) => c.formula.startsWith(`=${name}(`));
      expect(own.length, name).toBeGreaterThanOrEqual(5);
      for (const kind of ['boundary', 'error', 'arity'] as const) {
        expect(
          own.some((c) => c.kind === kind),
          `${name} ${kind}`,
        ).toBe(true);
      }
    }
  });
});

describe('root finding', () => {
  beforeAll(() => loadFinance(), 60_000);
  it('starts from the guess, as the reference apps do, and finds the root nearest it', () => {
    // 132u^2 - 230u + 100 = 0 with u = 1/(1+r) has roots r = 0.1 and r = 0.2.
    expect(run('=IRR({-100,230,-132},0.05)')).toBeCloseTo(0.1, 12);
    expect(run('=IRR({-100,230,-132},0.3)')).toBeCloseTo(0.2, 12);
  });

  it('falls back to a scan when Newton steps leave the domain', () => {
    // From a guess of -0.99 the first Newton step jumps below -1; the scan still finds 10%.
    expect(run('=IRR({-100,110},-0.99)')).toBeCloseTo(0.1, 12);
    expect(run('=RATE(1,0,-100,110,0,-0.99)')).toBeCloseTo(0.1, 12);
  });

  it('solves a long cash-flow list quickly', () => {
    const start = performance.now();
    const flows = ['-1000', ...Array.from({ length: 400 }, () => '10')].join(',');
    // 400 payments of 10 on 1000: the rate found must make the net present value zero.
    const r = run(`=IRR({${flows}})`) as number;
    const npv = Array.from({ length: 400 }, (_, i) => 10 / Math.pow(1 + r, i + 1)).reduce((a, b) => a + b, -1000);
    expect(Math.abs(npv)).toBeLessThan(1e-6);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('hostile input', () => {
  beforeAll(() => loadFinance(), 60_000);
  it('answers a trillion periods at once: no function works once per period without a bound', () => {
    // The answers are fixture cases. Here only the time counts: looping once per period would take hours.
    const huge = (fixture.cases as Case[]).filter((c) => c.formula.includes('1E12'));
    expect(huge.length).toBeGreaterThanOrEqual(8);
    const start = performance.now();
    for (const c of huge) run(c.formula, c.cells);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('solves a bond yield over the widest date spans quickly: no solver step walks every coupon', () => {
    // Issue on day 1 and dates up to the year 9999 mean tens of thousands of coupons. The answers are fixture cases;
    // the last formula is the widest span on actual/actual, timed only. Each case is one cell, and a cell must not
    // hold up the page for long.
    const wide = (fixture.cases as Case[]).filter((c) => c.hostile).map((c) => c.formula);
    expect(wide.length).toBeGreaterThanOrEqual(8);
    wide.push('=YIELD(1,2958465,0.05,1E300,100,4,1)');
    for (const formula of wide) {
      const start = performance.now();
      run(formula);
      expect(performance.now() - start, formula).toBeLessThan(2000);
    }
  });
});

describe('the financial family', () => {
  beforeAll(() => loadFinance(), 60_000);
  it('registers the 55 functions', () => {
    const names = [...REGISTRY.values()].filter((s) => s.family === 'finance').map((s) => s.name);
    expect(names.sort()).toEqual(
      (
        'ACCRINT ACCRINTM AMORDEGRC AMORLINC COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD CUMIPMT CUMPRINC DB ' +
        'DDB DISC DOLLARDE DOLLARFR DURATION EFFECT FV FVSCHEDULE INTRATE IPMT IRR ISPMT MDURATION MIRR NOMINAL NPER ' +
        'NPV ODDFPRICE ODDFYIELD ODDLPRICE ODDLYIELD PDURATION PMT PPMT PRICE PRICEDISC PRICEMAT PV RATE RECEIVED RRI ' +
        'SLN SYD TBILLEQ TBILLPRICE TBILLYIELD VDB XIRR XNPV YIELD YIELDDISC YIELDMAT'
      ).split(' '),
    );
  });

  const text = fnFinance as Record<string, { summary: string; args: Record<string, string> }>;
  it.each(functions.map((f) => [f.name, f] as const))(
    '%s has a description with matching argument names',
    (name, f) => {
      expect(text[name]?.summary, `strings entry for ${name}`).toBeTruthy();
      expect(Object.keys(text[name].args).sort()).toEqual(
        f.params.flatMap((p) => ('repeat' in p ? p.repeat : [p]).map((q) => q.name)).sort(),
      );
    },
  );

  it.each(functions.map((f) => [f.name, f.meta.example] as const))(
    '%s example gives what it says',
    (_name, example) => {
      const [formula, said] = example.split(' gives ');
      const shown = said.split(',')[0];
      const decimals = shown.includes('.') ? shown.split('.')[1].length : 0;
      const got = run(formula);
      expect(typeof got).toBe('number');
      expect(Math.abs((got as number) - Number(shown))).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-12);
    },
  );
});
