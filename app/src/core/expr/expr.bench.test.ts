// Benchmark for the shared expression engine (numbers in docs/perf/expr-engine.md). Each figure is the fastest of
// several rounds, because other work on a machine only ever slows a round down. The budgets are about ten times
// what a quiet laptop needs, so the test fails on a real slowdown and not on a busy afternoon. It prints its numbers.

import { describe, expect, it, vi } from 'vitest';
import { compileNode } from './compile';
import { differentiate } from './derive';
import { evaluateExact } from './exact';
import { evaluateLines } from './lines';
import { mathConstant } from './constants';
import { standardFunctions } from './functions';
import { evaluate, GENERAL } from './general';
import { parse } from './parser';
import { formatExpression } from './print';
import { rational } from './rational';
import { NOTES_TEST, SHEET, TEST_UNITS } from './testing';

vi.setConfig({ testTimeout: 120_000 });

const CALC = [
  '2*sin(30)+sqrt(16)^2/3-4!',
  '(1+2)*(3+4)/7 - 2^10 + 100 mod 7',
  'ln(e^3) + log(1000) + 5!/3!',
  '0.1+0.2*3-4/5+6^2',
  'nCr(52,5)/nPr(10,3) + hypot(3,4)',
  '1/3*3 + sqrt(2)^2 + 50%*200',
];

const FORMULAS = [
  'IF([Qty]>2, [Price]*[Qty]*1.2, SUM(A1:B5)/COUNT([Price]))',
  '[Price]*[Qty]-[Price]*[Qty]*15%',
  'ROUND(SUM([Total])/COUNT([Total]),2)&" avg"',
  'IFERROR(VLOOKUP(A1,B1:C9,2),0)+MAX(A1:A100)',
  '(A1+B1)*(C1-D1)/SUM(E:E)',
  'LEFT("abcdef",3)&UPPER([Name])&TEXT(1234.5,"0.0")',
];

const CURVES = [
  'x^3 - 2x + 1',
  'sin(x)*x^2 + 3x - 1/(x^2+1)',
  'e^(-x^2) * cos(5x)',
  '(x+1)(x-1)/(x^2+1)',
  'sqrt(abs(x)) + ln(1+x^2)',
];

const PAGE = Array.from({ length: 25 }, (_, i) => [
  `item${i} = ${i + 1},000`,
  `item${i} * 12 / 365 =`,
  `Notes for line ${i}: nothing to calculate`,
  `${i + 1} km + ${i * 10} m in mi =`,
]).flat();

/** Nanoseconds per call of `run`, as the fastest of `rounds` rounds of `iterations` calls. */
function nanos(iterations: number, run: () => void, rounds = 9): number {
  for (let i = 0; i < Math.min(iterations, 1000); i++) run();
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) run();
    best = Math.min(best, ((performance.now() - started) * 1e6) / iterations);
  }
  return best;
}

const report: string[] = [];
const note = (label: string, value: number, unit: string) => {
  const shown = value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1);
  report.push(`${label}: ${shown} ${unit}`);
};

describe('performance', () => {
  it('reads and runs calculator expressions', () => {
    const tokenParse = nanos(4000, () => CALC.forEach((s) => parse(s, GENERAL))) / CALC.length;
    const whole = nanos(4000, () => CALC.forEach((s) => evaluate(s))) / CALC.length;
    note('parse a calculator expression', tokenParse, 'ns each');
    note('parse and evaluate a calculator expression', whole, 'ns each');
    expect(tokenParse).toBeLessThan(100_000);
    expect(whole).toBeLessThan(300_000);
  });

  it('reads spreadsheet formulas', () => {
    const ns = nanos(4000, () => FORMULAS.forEach((s) => parse(s, SHEET))) / FORMULAS.length;
    note('parse a spreadsheet formula', ns, 'ns each');
    expect(ns).toBeLessThan(150_000);
  });

  it('runs a compiled curve fast enough to redraw a graph', () => {
    const table = standardFunctions('plain');
    const runs = CURVES.map((source) =>
      compileNode<{ x: number }>(parse(source, GENERAL), {
        strict: false,
        table,
        bind: (name) => {
          if (name === 'x') return (ctx) => ctx.x;
          const value = mathConstant(name);
          return value === undefined ? undefined : () => value;
        },
      }),
    );
    const frame = { x: 0 };
    const total = nanos(
      5,
      () => {
        let sum = 0;
        for (const run of runs) {
          for (let i = 0; i < 20_000; i++) {
            frame.x = i * 0.001;
            sum += run(frame);
          }
        }
        if (Number.isNaN(sum)) throw new Error('nothing was calculated');
      },
      7,
    );
    const each = total / (runs.length * 20_000);
    note('evaluate a compiled curve at one x', each, 'ns each');
    note('evaluate five curves at 20,000 points', total / 1e6, 'ms for 100,000 points');
    expect(total / 1e6).toBeLessThan(500);
  });

  it('keeps exact fractions fast enough for a notes page', () => {
    const env = { name: (name: string) => (name === 'a' ? rational(2n, 3n) : undefined) };
    const trees = [
      '0.1 + 0.2 - 0.3',
      '30!',
      'nCr(60, 30)',
      '(a + 1/3)^10',
      'sqrt(49/4) + 2^-3',
      'floor(17/5) * mod(17, 5)',
    ].map((s) => parse(s, GENERAL));
    const ns = nanos(2000, () => trees.forEach((t) => evaluateExact(t, env))) / trees.length;
    note('evaluate an expression with exact fractions', ns, 'ns each');
    expect(ns).toBeLessThan(500_000);
  });

  it('differentiates, simplifies, and writes expressions', () => {
    const trees = CURVES.map((s) => parse(s, GENERAL));
    const derive = nanos(1500, () => trees.forEach((t) => differentiate(t, 'x'))) / trees.length;
    const derivatives = trees.map((t) => differentiate(t, 'x'));
    const write = nanos(3000, () => derivatives.forEach((t) => formatExpression(t))) / trees.length;
    note('differentiate and simplify an expression', derive, 'ns each');
    note('write an expression as text', write, 'ns each');
    expect(derive).toBeLessThan(1_000_000);
    expect(write).toBeLessThan(200_000);
  });

  it('evaluates a page of 100 lines of math', () => {
    expect(PAGE).toHaveLength(100);
    const ns = nanos(150, () => {
      evaluateLines(PAGE, { dialect: NOTES_TEST, units: TEST_UNITS, constants: mathConstant, angle: 'deg' });
    });
    note('evaluate a page of 100 lines with units', ns / 1e6, 'ms per page');
    expect(ns / 1e6).toBeLessThan(100);
  });

  it('prints its numbers', () => {
    console.info(`\nExpression engine\n${report.join('\n')}`);
    expect(report.length).toBeGreaterThan(0);
  });
});
