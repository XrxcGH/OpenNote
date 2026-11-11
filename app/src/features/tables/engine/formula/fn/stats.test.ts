// The statistical families. Expected values are worked by hand in the comments, come from published tables or the
// documented examples of the spreadsheet functions, or are NIST's certified values; none is read back from the code.
// Formulas run through the engine, so argument delivery is tested too.

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import type { Table } from '../../model';
import { spillRange } from '../../recalc';
import { ERROR_TOKENS, arrayOf, isArray, isError, toScalar, type Scalar, type Value } from '../../values';
import fixture from '../../../fixtures/fn/stats.json';
import norris from '../../../fixtures/fn/nist/Norris.json';
import { fnStats, type FnText } from '../../../../../strings/en/fnStats';
import { REGISTRY, paramsOf } from '.';
import { loadStatistics, onStatisticsLoaded, statisticsLoaded } from './statsKit';
import { fill, runs as etsRuns, startOf } from './forecastEts';
import { leastSquares } from './regression';

const COLUMNS = 'ABCDEFGHIJKLMNOP'.split('').map((name) => ({ name, type: 'number' as const }));
const RESULT = { row: 0, col: 8 };

/**
 * Runs a formula in cell I1 of a table with the given data in columns A to G. A result that spills comes back as
 * the array of its block, so array functions can be checked whole.
 */
function calc(formula: string, data: string[][] = []): Value {
  const rows = Array.from({ length: Math.max(12, data.length) }, (_, r) =>
    Array.from({ length: COLUMNS.length }, (_, c) => data[r]?.[c] ?? ''),
  );
  let table: Table = createTable(COLUMNS, rows, EN_US, undefined, 1);
  table = setCellInput(table, { ...RESULT, raw: `=${formula}` }, EN_US);
  const box = spillRange(table, RESULT.col, RESULT.row);
  if (box === undefined) return table.rows[RESULT.row].cells[RESULT.col].value;
  const block: Scalar[][] = [];
  for (let r = box.r1; r <= box.r2; r++) {
    block.push(table.rows[r].cells.slice(box.c1, box.c2 + 1).map((cell) => toScalar(cell.value)));
  }
  return arrayOf(block);
}

const code = (v: Value): unknown => (isError(v) ? ERROR_TOKENS[v.error] : v);

/** True when `actual` matches `expected` to `digits` significant digits. */
function near(actual: Value, expected: number, digits = 14): void {
  expect(typeof actual, `got ${JSON.stringify(actual)}`).toBe('number');
  const scale = Math.max(Math.abs(expected), 1e-300);
  expect(Math.abs((actual as number) - expected) / scale, `${String(actual)} vs ${expected}`).toBeLessThan(
    5 * 10 ** -digits,
  );
}

/** The items of an array result, row by row. */
const items = (v: Value): unknown[] => (isArray(v) ? v.data.map((x) => code(x)) : [code(v)]);

const STATISTICAL =
  `AVEDEV AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV
CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CONFIDENCE.NORM CONFIDENCE.T CORREL COUNT COUNTA COUNTBLANK
COUNTIF COUNTIFS COVARIANCE.P COVARIANCE.S DEVSQ EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FISHER FISHERINV
FORECAST FORECAST.LINEAR FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FREQUENCY GAMMA
GAMMA.DIST GAMMA.INV GAMMALN GAMMALN.PRECISE GAUSS GEOMEAN GROWTH HARMEAN HYPGEOM.DIST INTERCEPT KURT LARGE LINEST LOGEST
LOGNORM.DIST LOGNORM.INV MAX MAXA MAXIFS MEDIAN MIN MINA MINIFS MODE.MULT MODE.SNGL NEGBINOM.DIST NORM.DIST NORM.INV
NORM.S.DIST NORM.S.INV PEARSON PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC PERMUT PERMUTATIONA PHI
POISSON.DIST PROB QUARTILE.EXC QUARTILE.INC RANK.AVG RANK.EQ RSQ SKEW SKEW.P SLOPE SMALL STANDARDIZE STDEV.P STDEV.S
STDEVA STDEVPA STEYX T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TREND TRIMMEAN VAR.P VAR.S VARA VARPA WEIBULL.DIST
Z.TEST COUNTUNIQUE`.split(/\s+/);

const COMPATIBILITY = `BETADIST BETAINV BINOMDIST CHIDIST CHIINV CHITEST CONFIDENCE COVAR CRITBINOM EXPONDIST FDIST FINV
FTEST GAMMADIST GAMMAINV HYPGEOMDIST LOGINV LOGNORMDIST MODE NEGBINOMDIST NORMDIST NORMINV NORMSDIST NORMSINV PERCENTILE
PERCENTRANK POISSON QUARTILE RANK STDEV STDEVP TDIST TINV TTEST VAR VARP WEIBULL ZTEST`.split(/\s+/);

// This block runs first, before anything loads the chunk: vitest gives each test file its own modules.
describe('the lazy chunk of distributions and compatibility names (lane test)', () => {
  it('shows #BUSY! until the chunk loads, then calculates, and tells listeners', async () => {
    expect(statisticsLoaded()).toBe(false);
    let told = 0;
    const stop = onStatisticsLoaded(() => (told += 1));
    expect(code(calc('NORM.S.DIST(1,TRUE)'))).toBe('#BUSY!');
    expect(code(calc('NORMSDIST(1)'))).toBe('#BUSY!');
    expect(calc('STDEV.P(2,4,4,4,5,5,7,9)')).toBe(2);
    await loadStatistics();
    stop();
    expect(told).toBe(1);
    expect(statisticsLoaded()).toBe(true);
    near(calc('NORM.S.DIST(1,TRUE)'), 0.841344746068543);
  });
});

describe('the lane tests', () => {
  beforeAll(() => loadStatistics());

  it('STDEV and VAR of 2, 4, 4, 4, 5, 5, 7, 9 (lane test)', () => {
    // The mean is 5 and the squared deviations add to 32: 32/7 and 32/8.
    const data = '{2,4,4,4,5,5,7,9}';
    near(calc(`STDEV.S(${data})`), 2.1380899352994);
    expect(calc(`STDEV.P(${data})`)).toBe(2);
    near(calc(`VAR.S(${data})`), 4.57142857142857);
    expect(calc(`VAR.P(${data})`)).toBe(4);
  });

  it('the normal, binomial, and Poisson laws (lane test)', () => {
    near(calc('NORM.S.DIST(1,TRUE)'), 0.841344746068543);
    near(calc('NORM.S.INV(0.975)'), 1.95996398454005);
    // C(10, 6) / 2^10 = 210/1024, and 5^2 e^-5 / 2!.
    expect(calc('BINOM.DIST(6,10,0.5,FALSE)')).toBe(0.205078125);
    near(calc('POISSON.DIST(2,5,FALSE)'), 0.0842243374885683);
  });

  it('percentiles, quartiles, mode, rank, and GAMMALN (lane test)', () => {
    // Position 0.3 x 3 = 0.9 between 1 and 2; position 0.25 x 7 = 1.75 between 2 and 4.
    near(calc('PERCENTILE.INC({1,2,3,4},0.3)'), 1.9);
    near(calc('QUARTILE.INC({1,2,4,7,8,9,10,12},1)'), 3.5);
    expect(calc('MODE.SNGL({1,2,2,3})')).toBe(2);
    // One value above 3, and two threes share places 2 and 3.
    expect(calc('RANK.AVG(3,{1,3,3,5})')).toBe(2.5);
    near(calc('GAMMALN(4)'), Math.log(6));
    near(calc('GAMMALN(4)'), 1.79175946922805);
  });

  it('LINEST on the NIST Norris dataset matches the certified values to 12 digits (lane test)', () => {
    const data = norris.y.map((y, i) => [String(y), String(norris.x[i])]);
    const fit = calc('LINEST(A1:A36,B1:B36,TRUE,TRUE)', data);
    if (!isArray(fit)) throw new Error(`LINEST gave ${JSON.stringify(fit)}`);
    expect([fit.rows, fit.cols]).toEqual([5, 2]);
    const at = (r: number, c: number) => fit.data[r * 2 + c];
    const want = norris.certified;
    near(at(0, 0), want.slope, 12);
    near(at(0, 1), want.intercept, 12);
    near(at(1, 0), want.slopeSe, 12);
    near(at(1, 1), want.interceptSe, 12);
    near(at(2, 0), want.rSquared, 12);
    near(at(2, 1), want.residualSd, 12);
    expect(at(3, 1)).toBe(want.df);
    near(calc('SLOPE(A1:A36,B1:B36)', data), want.slope, 12);
    near(calc('INTERCEPT(A1:A36,B1:B36)', data), want.intercept, 12);
  });

  it('NORM.INV undoes NORM.DIST within 1e-9 for 1,000 random inputs (lane test, property)', () => {
    const dist = REGISTRY.get('NORM.DIST')!;
    const inv = REGISTRY.get('NORM.INV')!;
    const env = { today: () => 0 };
    // z stays where a double keeps the upper tail's digits: above z = 3, 1 - p has too few bits to invert.
    const input = fc.record({
      m: fc.double({ min: -100, max: 100, noNaN: true }),
      s: fc.double({ min: 0.01, max: 100, noNaN: true }),
      z: fc.double({ min: -6, max: 3, noNaN: true }),
    });
    fc.assert(
      fc.property(input, ({ m, s, z }) => {
        const x = m + z * s;
        const p = dist.run([x, m, s, true], env) as number;
        const back = inv.run([p, m, s], env) as number;
        return Math.abs(back - x) <= 1e-9 * Math.max(1, Math.abs(x));
      }),
      { numRuns: 1000 },
    );
  });
});

describe('the registry', () => {
  beforeAll(() => loadStatistics());

  it('holds all 111 statistical and 38 compatibility names, each in its family', () => {
    // The design's statistical row: 111 Excel names plus the Sheets name COUNTUNIQUE.
    expect(STATISTICAL).toHaveLength(112);
    expect(COMPATIBILITY).toHaveLength(38);
    for (const name of STATISTICAL) expect(REGISTRY.get(name)?.family, name).toBe('stats');
    for (const name of COMPATIBILITY) expect(REGISTRY.get(name)?.family, name).toBe('statsCompat');
    const extra = [...REGISTRY.values()]
      .filter((s) => s.family === 'stats' || s.family === 'statsCompat')
      .map((s) => s.name)
      .filter((name) => !STATISTICAL.includes(name) && !COMPATIBILITY.includes(name));
    expect(extra).toEqual([]);
  });

  it('describes every function and every argument in fnStats, with an example of our own', () => {
    const text = fnStats as Readonly<Record<string, FnText | undefined>>;
    for (const name of [...STATISTICAL, ...COMPATIBILITY]) {
      const spec = REGISTRY.get(name)!;
      const entry = text[name];
      expect(entry?.description, name).toMatch(/^[A-Z].*\.$/);
      for (const param of paramsOf(spec)) expect(entry?.params[param.name], `${name} ${param.name}`).toMatch(/\.$/);
      expect(spec.meta.signature.startsWith(`${name}(`), name).toBe(true);
      expect(spec.meta.example, name).toMatch(new RegExp(`^=${name.replace(/\./g, '\\.')}\\(`));
    }
  });

  it('gives #VALUE! for too few or too many arguments', () => {
    expect(code(calc('NORM.DIST(1,2,3)'))).toBe('#VALUE!');
    expect(code(calc('STDEV.S()'))).toBe('#VALUE!');
    expect(code(calc('PERCENTILE.INC({1,2},0.5,1)'))).toBe('#VALUE!');
    expect(code(calc('TDIST(1,2)'))).toBe('#VALUE!');
  });
});

describe('the compatibility names', () => {
  beforeAll(() => loadStatistics());

  it('give what their modern forms give', () => {
    const pairs: [string, string][] = [
      ['STDEV(2,4,4,4,5,5,7,9)', 'STDEV.S(2,4,4,4,5,5,7,9)'],
      ['VARP(1,2,3,4)', 'VAR.P(1,2,3,4)'],
      ['NORMSDIST(1.5)', 'NORM.S.DIST(1.5,TRUE)'],
      ['NORMSINV(0.3)', 'NORM.S.INV(0.3)'],
      ['CHIDIST(3,4)', 'CHISQ.DIST.RT(3,4)'],
      ['CHIINV(0.2,4)', 'CHISQ.INV.RT(0.2,4)'],
      ['FDIST(2,3,4)', 'F.DIST.RT(2,3,4)'],
      ['FINV(0.2,3,4)', 'F.INV.RT(0.2,3,4)'],
      ['TINV(0.1,7)', 'T.INV.2T(0.1,7)'],
      ['TDIST(1.2,7,2)', 'T.DIST.2T(1.2,7)'],
      ['TDIST(1.2,7,1)', 'T.DIST.RT(1.2,7)'],
      ['LOGNORMDIST(2,0.1,0.5)', 'LOGNORM.DIST(2,0.1,0.5,TRUE)'],
      ['HYPGEOMDIST(1,4,8,20)', 'HYPGEOM.DIST(1,4,8,20,FALSE)'],
      ['NEGBINOMDIST(10,5,0.25)', 'NEGBINOM.DIST(10,5,0.25,FALSE)'],
      ['CRITBINOM(6,0.5,0.75)', 'BINOM.INV(6,0.5,0.75)'],
      ['BETADIST(0.3,2,3)', 'BETA.DIST(0.3,2,3,TRUE)'],
      ['QUARTILE({1,2,4,7,8,9,10,12},3)', 'QUARTILE.INC({1,2,4,7,8,9,10,12},3)'],
      ['PERCENTRANK({1,2,3,4,5},2.5)', 'PERCENTRANK.INC({1,2,3,4,5},2.5)'],
      ['RANK(3,{1,3,3,5},1)', 'RANK.EQ(3,{1,3,3,5},1)'],
      ['MODE(4,4,1,1)', 'MODE.SNGL(4,4,1,1)'],
      ['COVAR({3,2,4,5,6},{9,7,12,15,17})', 'COVARIANCE.P({3,2,4,5,6},{9,7,12,15,17})'],
      ['ZTEST({3,6,7,8,6,5,4,2,1,9},4)', 'Z.TEST({3,6,7,8,6,5,4,2,1,9},4)'],
      ['TTEST({1,3},{3,5},2,2)', 'T.TEST({1,3},{3,5},2,2)'],
    ];
    for (const [old, modern] of pairs) expect(calc(old), old).toEqual(calc(modern));
  });
});

describe('regression and forecasting', () => {
  beforeAll(() => loadStatistics());

  it('LINEST with stats on a line worked by hand', () => {
    // x 1..4, y 2,3,5,6: slope 7/5, intercept 1/2, residuals .1 -.3 .3 -.1, so SSresid 0.2 and SSreg 9.8.
    const fit = items(calc('LINEST({2,3,5,6},{1,2,3,4},TRUE,TRUE)'));
    const want = [1.4, 0.5, Math.sqrt(0.02), Math.sqrt(0.15), 0.98, Math.sqrt(0.1), 98, 2, 9.8, 0.2];
    want.forEach((w, i) => near(fit[i] as number, w, 12));
  });

  it('LINEST without an intercept, with two variables, and with a column that repeats another', () => {
    expect(items(calc('LINEST({2,4,6},{1,2,3},FALSE)'))).toEqual([2, 0]);
    // y = 1 + 2 a + 3 b exactly, so the coefficients come back b first.
    const two = items(calc('LINEST({6;8;14;16;18},{1,1;2,1;2,3;3,3;1,5})'));
    [3, 2, 1].forEach((w, i) => near(two[i] as number, w, 12));
    const same = items(calc('LINEST({2;3;5;6},{1,2;2,4;3,6;4,8},TRUE,TRUE)'));
    expect(same.slice(0, 3).filter((v) => v === 0)).toHaveLength(1);
    expect(same[10]).toBe(2);
    expect(same[8]).toBe('#N/A');
    expect(code(calc('LINEST({1,2,3},{1,2})'))).toBe('#REF!');
    expect(code(calc('LINEST({1,"a",3})'))).toBe('#VALUE!');
  });

  it('LOGEST, TREND, and GROWTH', () => {
    // y = 1 * 2^x exactly.
    const log = items(calc('LOGEST({2,4,8,16},{1,2,3,4})'));
    near(log[0] as number, 2, 12);
    near(log[1] as number, 1, 12);
    expect(items(calc('TREND({3,5,7},{1,2,3},{4;5})'))).toEqual([9, 11]);
    near(calc('GROWTH({2,4,8},{1,2,3},4)'), 16, 12);
    expect(code(calc('LOGEST({1,0,2})'))).toBe('#NUM!');
  });

  it('FORECAST.ETS forecasts a line and a line plus a season exactly', () => {
    near(calc('FORECAST.ETS(7,{2,4,6,8,10,12},{1,2,3,4,5,6})'), 14, 9);
    // y = t plus the season 0, 4, 0, -4.
    const y = '{1,6,3,0,5,10,7,4,9,14,11,8}';
    const t = '{1,2,3,4,5,6,7,8,9,10,11,12}';
    expect(calc(`FORECAST.ETS.SEASONALITY(${y},${t})`)).toBe(4);
    near(calc(`FORECAST.ETS(13,${y},${t})`), 13, 9);
    near(calc(`FORECAST.ETS(14,${y},${t})`), 18, 9);
    near(calc(`FORECAST.ETS(14,${y},${t},4)`), 18, 9);
    expect(calc(`FORECAST.ETS.STAT(${y},${t},8)`)).toBe(1);
    expect(Math.abs(calc(`FORECAST.ETS.CONFINT(13,${y},${t})`) as number)).toBeLessThan(1e-6);
  });

  it('FORECAST.ETS averages repeated times, fills a gap, and refuses an uneven timeline', () => {
    // Time 2 averages 3 and 5 to 4; time 3 is filled with 6; the series 2, 4, 6, 8, 10, 12 is a line.
    near(calc('FORECAST.ETS(7,{2,3,5,8,10,12},{1,2,2,4,5,6})'), 14, 9);
    expect(code(calc('FORECAST.ETS(7,{1,2,3},{1,2,3.5})'))).toBe('#NUM!');
    expect(code(calc('FORECAST.ETS(2,{2,4,6,8},{1,2,3,4})'))).toBe('#NUM!');
    expect(code(calc('FORECAST.ETS(5,{2,4,6},{1,2,3,4})'))).toBe('#N/A');
    expect(code(calc('FORECAST.ETS.STAT({2,4,6,8},{1,2,3,4},9)'))).toBe('#NUM!');
  });
});

describe('conditional and array functions in a table', () => {
  beforeAll(() => loadStatistics());

  const data = [
    ['1', 'x', '10'],
    ['2', 'x', '20'],
    ['3', 'y', '30'],
    ['4', 'x', ''],
  ];

  it('COUNTIF, COUNTIFS, AVERAGEIF, AVERAGEIFS, MAXIFS, MINIFS, COUNTBLANK', () => {
    expect(calc('COUNTIF(A1:A4,">1")', data)).toBe(3);
    expect(calc('COUNTIFS(A1:A4,">1",B1:B4,"x")', data)).toBe(2);
    expect(calc('AVERAGEIF(B1:B4,"x",C1:C4)', data)).toBe(15);
    expect(calc('AVERAGEIFS(C1:C4,B1:B4,"x",A1:A4,">1")', data)).toBe(20);
    expect(calc('MAXIFS(C1:C4,B1:B4,"x")', data)).toBe(20);
    expect(calc('MINIFS(C1:C4,A1:A4,">1")', data)).toBe(20);
    expect(calc('COUNTBLANK(C1:C4)', data)).toBe(1);
    expect(code(calc('AVERAGEIF(B1:B4,"z",C1:C4)', data))).toBe('#DIV/0!');
    expect(code(calc('COUNTIFS(A1:A4,">1",B1:B3,"x")', data))).toBe('#VALUE!');
    expect(items(calc('COUNTIF(A1:A4,{1,2})', data))).toEqual([1, 1]);
  });

  it('skips text and empty cells in a column but counts typed TRUE in the A functions', () => {
    expect(calc('AVERAGE(C1:C4)', data)).toBe(20);
    expect(calc('STDEV.P(C1:C4)', data) as number).toBeCloseTo(Math.sqrt(200 / 3), 12);
    expect(calc('AVERAGEA(B1:B4)', data)).toBe(0);
    expect(calc('MAXA(0,0.2,TRUE)')).toBe(1);
    expect(calc('COUNTUNIQUE(B1:B4)', data)).toBe(2);
  });
});

interface Case {
  formula: string;
  cells?: Record<string, number | string>;
  expected: number | string | (number | string)[];
  tolerance?: number;
  source: string;
  note: string;
  /** Marks a case that the fixture contract counts: a boundary, an error, or a wrong argument count. */
  kind?: 'boundary' | 'error' | 'arity';
}

/** Cells such as {"A1": 3} as rows of text for calc. */
function rowsOf(cells: Record<string, number | string> = {}): string[][] {
  const rows: string[][] = [];
  for (const [ref, value] of Object.entries(cells)) {
    const r = Number(ref.slice(1)) - 1;
    const c = ref.charCodeAt(0) - 65;
    rows[r] ??= [];
    rows[r][c] = String(value);
  }
  return Array.from({ length: rows.length }, (_, r) => rows[r] ?? []);
}

describe('the fixture of known answers', () => {
  beforeAll(() => loadStatistics());
  const cases = (fixture as { cases: Case[] }).cases;

  it('has a source and a note for every case', () => {
    expect(cases.length).toBeGreaterThan(80);
    for (const c of cases) {
      expect(c.source, c.formula).toMatch(/^(hand|excel-doc|sheets-doc|nist|dlmf|table)/);
      expect(c.note.length, c.formula).toBeGreaterThan(3);
    }
  });

  it('gives every function five cases with a boundary, an error, and an argument count (lane test)', () => {
    const lead = (c: Case) => /^=([A-Z][A-Z0-9.]*)\(/.exec(c.formula)?.[1];
    const isError = (c: Case) => typeof c.expected === 'string' && c.expected.startsWith('#');
    const short: string[] = [];
    for (const name of [...STATISTICAL, ...COMPATIBILITY]) {
      const own = cases.filter((c) => lead(c) === name);
      const boundary = own.some((c) => c.kind === 'boundary');
      const error = own.some((c) => c.kind === 'error' || (c.kind !== 'arity' && isError(c)));
      const arity = own.some((c) => c.kind === 'arity' && c.expected === '#VALUE!');
      if (own.length < 5 || !boundary || !error || !arity) short.push(`${name} (${own.length})`);
    }
    expect(short).toEqual([]);
  });

  it.each(cases.map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    const got = calc(c.formula.slice(1), rowsOf(c.cells));
    const wants = Array.isArray(c.expected) ? c.expected : [c.expected];
    const have = items(got);
    expect(have, c.note).toHaveLength(wants.length);
    wants.forEach((want, i) => {
      if (typeof want === 'number') {
        const tol = c.tolerance ?? 1e-12;
        expect(Math.abs((have[i] as number) - want), `${c.formula}: ${String(have[i])}`).toBeLessThanOrEqual(
          tol * Math.max(1, Math.abs(want)),
        );
      } else {
        expect(have[i], c.formula).toBe(want);
      }
    });
  });
});

// Phi(1) from the table of the normal law (Abramowitz and Stegun, table 26.1).
const PHI1 = 0.8413447460685429;

describe('discrete laws with huge arguments', () => {
  beforeAll(() => loadStatistics());

  it('PERMUT stops once the product overflows', () => {
    expect(code(calc('PERMUT(1E300,1E300)'))).toBe('#NUM!');
    expect(code(calc('PERMUT(2E8,2E8)'))).toBe('#NUM!');
    expect(calc('PERMUT(100,3)')).toBe(970200);
  });

  it('BINOM.INV, CRITBINOM, and BINOM.DIST.RANGE bisect or subtract past a thousand trials', () => {
    // The median of a symmetric binomial law with an even number of trials is half of them.
    expect(calc('BINOM.INV(1E7,0.5,0.5)')).toBe(5e6);
    expect(calc('BINOM.INV(1E9,0.5,0.5)')).toBe(5e8);
    expect(calc('CRITBINOM(1E7,0.5,0.5)')).toBe(5e6);
    // P(X <= k) < 1 for every k < n, so alpha = 1 is reached only at n.
    expect(calc('BINOM.INV(1E7,0.5,1)')).toBe(1e7);
    // 1 - 1E-13 is Phi(7.35), so the answer is 7 to 8 standard deviations (sqrt(n) / 2 = 1581) above the median.
    const top = calc('BINOM.INV(1E7,0.5,0.9999999999999)') as number;
    expect(top).toBeGreaterThan(5e6 + 7 * 1581);
    expect(top).toBeLessThan(5e6 + 8 * 1581);
    near(calc('BINOM.DIST.RANGE(1E6,0.5,0,1E6)'), 1, 12);
    // Half, plus half the central term C(n, n/2) / 2^n = sqrt(2 / (pi n)) (1 - 1 / (4 n)).
    near(calc('BINOM.DIST.RANGE(1E6,0.5,0,500000)'), 0.5 + Math.sqrt(2 / (Math.PI * 1e6)) * (1 - 2.5e-7) * 0.5, 10);
    near(calc('BINOM.DIST.RANGE(1E9,0.5,0,1E9)'), 1, 12);
  });

  it('HYPGEOM.DIST sums from k away from the mode', () => {
    // Draws, successes, and half the population alike: the law is symmetric about 250000.
    const lower = calc('HYPGEOM.DIST(249999,500000,500000,1000000,TRUE)') as number;
    const upper = calc('HYPGEOM.DIST(250000,500000,500000,1000000,TRUE)') as number;
    near(lower + upper, 1, 9);
    // The central term is about 1 / sqrt(2 pi var), var = n K (N - K) (N - n) / (N^2 (N - 1)).
    const sd = Math.sqrt(6.25e22 / (1e12 * 999999));
    near(upper - lower, 1 / (sd * Math.sqrt(2 * Math.PI)), 4);
    const big = calc('HYPGEOM.DIST(5E8,1E9,1E9,2E9,TRUE)') as number;
    expect(big).toBeGreaterThan(0.49);
    expect(big).toBeLessThan(0.51);
    near(calc('HYPGEOM.DIST(1,4,8,20,TRUE)'), 0.46542827657378744, 12);
  });
});

describe('the F and t laws at many degrees of freedom', () => {
  beforeAll(() => loadStatistics());

  it('the F law keeps its digits at a million and ten billion degrees of freedom', () => {
    // With equal degrees of freedom, the law of F is the law of 1 / F. So F <= 1 has probability one half.
    near(calc('F.DIST(1,1E6,1E6,TRUE)'), 0.5, 12);
    near(calc('F.DIST(1,1E10,1E10,TRUE)'), 0.5, 10);
    near(calc('F.DIST.RT(1,1E6,1E6)'), 0.5, 12);
    near(calc('FDIST(1,1E6,1E6)'), 0.5, 12);
    near(calc('F.INV(0.5,1E6,1E6)'), 1, 12);
    near(calc('F.INV.RT(0.5,1E6,1E6)'), 1, 12);
    near(calc('FINV(0.5,1E6,1E6)'), 1, 12);
    // As d2 grows, d1 F tends to chi-squared with d1 degrees of freedom: for d1 = 2, P = 1 - e^-1.
    near(calc('F.DIST(1,2,1E10,TRUE)'), 1 - Math.exp(-1), 9);
    // ln F is near normal with variance 2 / d1 + 2 / d2 = 4E-6, so ln F = 0.002 is one deviation up.
    near(calc('F.DIST(EXP(0.002),1E6,1E6,TRUE)'), PHI1, 5);
    near(calc('F.DIST(1,1E6,1E6,FALSE)'), 1 / Math.sqrt(2 * Math.PI * 4e-6), 5);
  });

  it('the t functions take 1 to 1E10 degrees of freedom and become the normal law', () => {
    expect(code(calc('T.DIST(1,1E15,TRUE)'))).toBe('#NUM!');
    expect(code(calc('T.DIST.2T(1,1E11)'))).toBe('#NUM!');
    expect(code(calc('T.INV(0.9,1E11)'))).toBe('#NUM!');
    expect(code(calc('TDIST(1,1E11,1)'))).toBe('#NUM!');
    near(calc('T.DIST(1,1E10,TRUE)'), PHI1, 10);
    near(calc('T.DIST.RT(1,1E10)'), 1 - PHI1, 9);
    near(calc('T.DIST(0,1E10,FALSE)'), 1 / Math.sqrt(2 * Math.PI), 10);
    near(calc('T.INV(0.975,1E10)'), 1.959963984540054, 9);
    near(calc('T.INV.2T(0.05,1E10)'), 1.959963984540054, 9);
  });
});

describe('FORECAST.ETS work stays bounded', () => {
  beforeAll(() => loadStatistics());

  it('FORECAST.ETS refuses a timeline wider than ten thousand steps', () => {
    expect(code(calc('FORECAST.ETS(200000,{1,2,3},{1,2,100001})'))).toBe('#NUM!');
    expect(code(calc('FORECAST.ETS.SEASONALITY({1,2,3},{1,2,1E9})'))).toBe('#NUM!');
    expect(code(calc('FORECAST.ETS.CONFINT(5,{1,2,3},{1,2,1E9})'))).toBe('#NUM!');
  });

  it('FORECAST.ETS fits a long series with a long season in bounded time', () => {
    // 3000 points of a line plus a season of 1000: the forecast continues both exactly.
    const n = 3000;
    const wave = (i: number) => i + 1 + 5 * Math.sin((2 * Math.PI * i) / 1000);
    const y = Array.from({ length: n }, (_, i) => wave(i));
    const t = Array.from({ length: n }, (_, i) => i + 1);
    const got = etsRuns['FORECAST.ETS']([n + 1, arrayOf([y]), arrayOf([t]), 1000], undefined as never);
    near(got, wave(n), 9);
  }, 20000);

  it('the start values match a least-squares fit with season columns', () => {
    const y = [3, 7, 4, 9, 5, 8, 6, 11, 7, 12, 8, 13, 9, 14];
    const m = 3;
    const dummies = [1, 2].map((p) => y.map((_, i) => (i % m === p ? 1 : 0)));
    const fit = leastSquares([y.map((_, i) => i), ...dummies], y, true);
    const raw = [0, fit.coef[1], fit.coef[2]];
    const shift = (raw[0] + raw[1] + raw[2]) / 3;
    const st = startOf(y, m);
    near(st.trend, fit.coef[0], 12);
    near(st.level, fit.intercept + shift - fit.coef[0], 12);
    st.season.forEach((s, p) => expect(Math.abs(s - (raw[p] - shift))).toBeLessThan(1e-12));
  });
});

describe('FORECAST.ETS parts', () => {
  beforeAll(() => loadStatistics());

  it('fills gaps in one pass: flat at the ends, straight lines between', () => {
    expect(fill([null, 2, null, null, 8, null], 1)).toEqual([2, 2, 4, 6, 8, 8]);
    expect(fill([null, 2, null, 8], 0)).toEqual([0, 2, 0, 8]);
  });

  it('FORECAST.ETS.CONFINT follows the AAA variance formula and takes a far target', () => {
    const y = '{3,7,4,9,5,8,6,11,7,12,8,13}';
    const t = '{1,2,3,4,5,6,7,8,9,10,11,12}';
    const [a, b, g, rmse] = [1, 2, 3, 7].map((k) => calc(`FORECAST.ETS.STAT(${y},${t},${k})`) as number);
    const m = calc(`FORECAST.ETS.SEASONALITY(${y},${t})`) as number;
    for (const h of [1, 2, 5, 9, 25]) {
      // sigma^2 (1 + sum of c_j^2 for j < h), c_j = alpha (1 + j beta), plus gamma (1 - alpha) on whole seasons.
      let factor = 1;
      for (let j = 1; j < h; j++) {
        const c = a * (1 + j * b) + (m > 1 && j % m === 0 ? g * (1 - a) : 0);
        factor += c * c;
      }
      near(calc(`FORECAST.ETS.CONFINT(${12 + h},${y},${t})`), 1.959963984540054 * rmse * Math.sqrt(factor), 9);
    }
    expect(typeof calc(`FORECAST.ETS.CONFINT(1E12,${y},${t})`)).toBe('number');
  });

  it('FORECAST.ETS aggregation 3 counts every value, numbers or not', () => {
    // Counts of values 1, 2, 3 make a line, so the next is 4; counts of numbers are 1, 1, 1.
    near(calc('FORECAST.ETS(4,{1,"b",3,"d","e",6},{1,2,2,3,3,3},1,1,3)'), 4, 9);
    near(calc('FORECAST.ETS(4,{1,"b",3,"d","e",6},{1,2,2,3,3,3},1,1,2)'), 1, 9);
  });
});

describe('long ranges stay bounded (lane test)', () => {
  beforeAll(() => loadStatistics());
  const env = { today: () => 0 };
  const run = (name: string, args: Value[]) => REGISTRY.get(name)!.run(args, env);

  it('FREQUENCY sorts the bins once: 100,000 values in 100,000 bins', () => {
    const n = 100_000;
    // Values 0.5, 1.5, ... and bins 1, 2, ... in reverse order: each bin holds one value, the last none.
    const data = arrayOf([Array.from({ length: n }, (_, i) => i + 0.5)]);
    const bins = arrayOf([Array.from({ length: n }, (_, i) => n - i)]);
    const start = performance.now();
    const got = run('FREQUENCY', [data, bins]);
    expect(performance.now() - start).toBeLessThan(3000);
    const counts = items(got);
    expect(counts).toHaveLength(n + 1);
    expect(counts.slice(0, 3)).toEqual([1, 1, 1]);
    expect(counts[n]).toBe(0);
    // A repeated edge counts once, at its first place; values on an edge fall in its bin.
    expect(items(calc('FREQUENCY({1,2,2,3,5,9},{2,5,2,0})'))).toEqual([3, 2, 0, 0, 1]);
  }, 20000);

  it('MIN, MAX, the modes, and MAXIFS take a million values without a stack overflow', () => {
    const n = 1_000_000;
    const values = Array.from({ length: n }, (_, i) => (i % 1000) - 500);
    // A list function gets the values of its ranges one by one; MAXIFS and FREQUENCY get the range whole.
    const range = arrayOf([values]);
    expect(run('MIN', values)).toBe(-500);
    expect(run('MAX', values)).toBe(499);
    expect(run('MINA', values)).toBe(-500);
    expect(run('MAXA', values)).toBe(499);
    // Every value appears 1,000 times, so the first, -500, is the mode.
    expect(run('MODE.SNGL', values)).toBe(-500);
    expect(run('MODE', values)).toBe(-500);
    expect(items(run('MODE.MULT', values))).toHaveLength(1000);
    expect(run('MAXIFS', [range, range, '<0'])).toBe(-1);
    expect(run('MINIFS', [range, range, '>0'])).toBe(1);
    expect(items(run('FREQUENCY', [range, arrayOf([[0]])]))).toEqual([501_000, 499_000]);
  }, 30000);
});

describe('distributions at the edges of a double', () => {
  beforeAll(() => loadStatistics());

  /** Runs a formula and fails if it takes longer than `ms`. */
  function timed(formula: string, ms = 5000): Value {
    const start = performance.now();
    const v = calc(formula);
    expect(performance.now() - start, formula).toBeLessThan(ms);
    return v;
  }

  it('BINOM.INV, CRITBINOM, and HYPGEOM.DIST stop past 2^53 counts', () => {
    // Past 2^53 a count is not a whole number in a double, so stepping or bisecting through it never ends.
    expect(code(timed('BINOM.INV(1E17,0.5,0.5)'))).toBe('#NUM!');
    expect(code(timed('CRITBINOM(1E300,0.5,0.5)'))).toBe('#NUM!');
    expect(code(timed('HYPGEOM.DIST(5E17,1E18,1E18,2E18,TRUE)'))).toBe('#NUM!');
    expect(code(timed('HYPGEOM.DIST(5E29,1E30,1E30,2E30,TRUE)'))).toBe('#NUM!');
    // Under 2^53 a spread of about 2E7 needs far more terms than the cap, so the sum gives up rather than hang.
    expect(code(timed('HYPGEOM.DIST(2E15,4E15,4E15,8E15,TRUE)'))).toBe('#NUM!');
  }, 30000);

  it('GAMMA.INV gives #NUM! or the median where the incomplete gamma runs out of terms', () => {
    // The median of the gamma law is a - 1/3 + 8 / (405 a) + ... (Choi, 1994).
    const v = timed('GAMMA.INV(0.5,1E13,1)', 10000);
    if (code(v) !== '#NUM!') near(v, 1e13 - 1 / 3, 9);
  }, 30000);

  it('BETA.DIST, BETA.INV, F.DIST, and F.INV keep small x on the wide path', () => {
    // For a small x, I_x(a, b) = x^a b^a (1 + a (a - 1) / (2 b)) / Gamma(a + 1), with Gamma(3/2) = sqrt(pi) / 2.
    const g = Math.sqrt(Math.PI) / 2;
    near(calc('BETA.DIST(1E-30,0.5,1000000,TRUE)'), (1e-15 * 1000 * (1 - 0.125e-6)) / g, 10);
    // F with d1 = 1: y = x / (x + d2), a = 1/2, b = d2 / 2.
    near(calc('F.DIST(1E-20,1,1000000,TRUE)'), (1e-13 * Math.sqrt(5e5) * (1 - 0.25 / 1e6)) / g, 10);
    // The inverse of the first form: x = (p g / (b^a (1 + a (a - 1) / (2 b))))^(1 / a).
    near(calc('BETA.INV(1E-9,0.5,1000000)'), ((1e-9 * g) / (1000 * (1 - 0.125e-6))) ** 2, 8);
    // F.INV: x = d2 y for a tiny y, with y from the same form at b = 5E5.
    near(calc('F.INV(1E-9,1,1000000)'), 1e6 * ((1e-9 * g) / (Math.sqrt(5e5) * (1 - 0.25 / 1e6))) ** 2, 8);
  });

  it('T.DIST and T.INV keep their digits near the center', () => {
    // Near 0 the t density is f(0) = (1 - 1 / (4 df)) / sqrt(2 pi), so P(T < t) = 1/2 + f(0) t.
    const slope = (df: number) => (1 - 1 / (4 * df)) / Math.sqrt(2 * Math.PI);
    near(calc('T.INV(0.5000000001,100000)'), (0.5000000001 - 0.5) / slope(1e5), 8);
    near(calc('T.INV.2T(0.999999999,100000)'), (0.5 - 0.999999999 / 2) / slope(1e5), 8);
    near(calc('T.INV(0.5000000001,1000000)'), (0.5000000001 - 0.5) / slope(1e6), 8);
    near(calc('T.INV(0.5000000001,100000000)'), (0.5000000001 - 0.5) / slope(1e8), 8);
    near(calc('T.INV(0.4999999999,100000)'), (0.4999999999 - 0.5) / slope(1e5), 8);
    const d = (calc('T.DIST(1E-10,100000,TRUE)') as number) - 0.5;
    near(d, 1e-10 * slope(1e5), 6);
  });

  it('BINOM.DIST keeps (1 - p)^(n - k) exact for a tiny p', () => {
    // n p (1 - p)^(n - 1), with ln(1 - p) = -p - p^2 / 2 - p^3 / 3 and p^3 n under 1E-18.
    const [n, p] = [276719929, 1.53736e-9];
    near(calc(`BINOM.DIST(1,${n},${p},FALSE)`), n * p * Math.exp((n - 1) * (-p - (p * p) / 2)), 12);
  });

  it('BETA.DIST keeps mid-size parameters on the exact power term', () => {
    // The beta law with a = b is symmetric about 1/2.
    near(calc('BETA.DIST(0.5,99999,99999,TRUE)'), 0.5, 12);
    near(calc('BETA.DIST(0.5,5000,5000,TRUE)'), 0.5, 12);
  });

  it('takes the edge values', () => {
    // P(X <= 1E308) for a mean of 1 is 1, and so is the F law at 1E308.
    expect(timed('POISSON.DIST(1E308,1,TRUE)', 1000)).toBe(1);
    expect(calc('F.DIST(1E308,5,5,TRUE)')).toBe(1);
    expect(calc('F.DIST.RT(1E308,5,5)')).toBe(0);
    // P(X <= k) < 1 for every k < n, so only n reaches alpha = 1.
    expect(calc('BINOM.INV(2000,0.5,1)')).toBe(2000);
    expect(calc('BINOM.INV(1000,0.5,1)')).toBe(1000);
    expect(calc('BINOM.INV(10,0.5,1)')).toBe(10);
    expect(code(calc('CHISQ.TEST({1,2},{-1,2})'))).toBe('#NUM!');
    // y = 1, 2, 4 on x = 1, 2, 3 (times 1E200): slope 3 / 2 (over 1E200), intercept 7/3 - 2 (3/2) = -2/3.
    const fit = items(calc('LINEST({1,2,4},{1E200,2E200,3E200},TRUE,TRUE)'));
    near(fit[0] as number, 1.5e-200, 12);
    near(fit[1] as number, -2 / 3, 12);
  });
});
