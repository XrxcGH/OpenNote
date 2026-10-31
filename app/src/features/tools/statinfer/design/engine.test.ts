// Study design. Expected values are hand calculations (Neyman allocation, margins of error, design effects) and
// the published Williams square for 4 conditions; random lists are checked for balance and reproducibility.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { assignReport, factorialReport, marginReport, sampleReport, squareReport } from './engine';
import {
  allOrders,
  allocate,
  blockAssignment,
  designEffect,
  drawSample,
  marginOfError,
  randomSquare,
  sampleSizeFor,
  stratifiedEstimate,
  williams,
} from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);
const isLatin = (square: number[][]) =>
  square.every((row) => new Set(row).size === row.length) &&
  square[0].every((_, j) => new Set(square.map((row) => row[j])).size === square.length);

describe('assignment and orders', () => {
  it('the Williams square for 4 conditions', () => {
    const rows = williams(4).map((row) => row.map((v) => 'ABCD'[v]).join(' '));
    expect(rows).toEqual(['A B D C', 'B C A D', 'C D B A', 'D A C B']);
  });

  it('Williams squares balance first-order carryover', () => {
    for (const n of [4, 5, 6]) {
      const square = williams(n);
      const follows = new Map<string, number>();
      for (const row of square)
        for (let j = 1; j < n; j += 1)
          follows.set(`${row[j - 1]}>${row[j]}`, (follows.get(`${row[j - 1]}>${row[j]}`) ?? 0) + 1);
      // Every ordered pair of different conditions appears once (twice across the 2 squares of an odd n).
      expect(follows.size).toBe(n * (n - 1));
      expect(new Set(follows.values()).size).toBe(1);
    }
  });

  it('permuted blocks of 4 for 2 arms balance each block and repeat with the seed', () => {
    const a = blockAssignment(['A', 'B'], 12, [4], 77n);
    for (let b = 0; b < 3; b += 1) {
      const block = a.list.slice(4 * b, 4 * b + 4);
      expect(block.filter((v) => v === 'A').length).toBe(2);
    }
    expect(blockAssignment(['A', 'B'], 12, [4], 77n).list).toEqual(a.list);
  });

  it('random squares are Latin, and all orders are counted', () => {
    expect(isLatin(randomSquare(6, 3n))).toBe(true);
    expect(allOrders(4).length).toBe(24);
  });
});

describe('sampling and estimation', () => {
  it('Neyman allocation of 100 over N_h 500, 300, 200 with S_h 10, 20, 30', () => {
    allocate(100, [500, 300, 200], [10, 20, 30]).forEach((v, i) => close(v, [29.4118, 35.2941, 35.2941][i], 1e-4));
  });

  it('margin of error for p 0.5, n 1000, 95%, without and with the FPC for N 5000', () => {
    const m = marginOfError(0.5, 1000, 0.95, 5000);
    close(m.plain, 0.0309898, 1e-6);
    close(m.finite ?? 0, 0.0277208, 1e-6);
  });

  it('design effect of clusters of 20 with ICC 0.05, and the effective n of 1000', () => {
    const d = designEffect(20, 0.05, 1000);
    close(d.deff, 1.95, 1e-12);
    close(d.effective, 512.82, 1e-2);
  });

  it('sample size for a margin of 0.03 at p 0.5, 95%, by hand', () => {
    // 1.959964² · 0.25 / 0.0009 = 1067.07, so 1068.
    expect(sampleSizeFor('proportion', 0.5, 0.03, 0.95, null).rounded).toBe(1068);
  });

  it('stratified mean and SE by hand', () => {
    // W = 0.5 each; means 2 and 6; s² = 1 and 4; n = 3 each; f = 0.03.
    const e = stratifiedEstimate([
      { name: 'a', N: 100, values: [1, 2, 3] },
      { name: 'b', N: 100, values: [4, 6, 8] },
    ]);
    close(e.mean, 4, 1e-12);
    close(e.se, Math.sqrt(0.25 * 0.97 * (1 / 3) + 0.25 * 0.97 * (4 / 3)), 1e-12);
  });

  it('samples from a frame', () => {
    const frame = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, group: i < 10 ? 'x' : 'y', size: i + 1 }));
    expect(drawSample(frame, 'simple', 5, 1n).length).toBe(5);
    expect(drawSample(frame, 'systematic', 4, 1n).length).toBe(4);
    const strat = drawSample(frame, 'stratified', 6, 1n);
    expect(strat.filter((r) => r.group === 'x').length).toBe(3);
    expect(drawSample(frame, 'cluster', 1, 1n).length).toBe(10);
    expect(drawSample(frame, 'pps', 5, 1n).length).toBe(5);
  });
});

describe('design reports and impossible input', () => {
  it('reports carry the lists', () => {
    expect(assignReport('block', ['A', 'B'], 8, [4], [], 5n).tables[1].rows).toEqual([
      ['A', 4],
      ['B', 4],
    ]);
    expect(squareReport('williams', ['A', 'B', 'C', 'D'], 1n).answer.vars.first).toBe('A B D C');
    expect(
      factorialReport(
        [
          { name: 'F', levels: ['a', 'b'] },
          { name: 'G', levels: ['x', 'y', 'z'] },
        ],
        2,
        1n,
      ).answer.vars.cells,
    ).toBe('6');
    expect(sampleReport([{ id: 'a', group: '', size: 1 }], 'simple', 1, 1n).answer.vars.n).toBe('1');
    expect(marginReport(0.5, 1000, 0.95, null, 0.03).tables[0].rows.length).toBe(2);
  });

  it('says what is wrong', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => blockAssignment(['A', 'B', 'C'], 6, [4], 1n))).toBe('blockMultiple');
    expect(code(() => blockAssignment(['A'], 6, [2], 1n))).toBe('twoConditions');
    expect(code(() => blockAssignment(['A', 'A'], 6, [2], 1n))).toBe('repeatedCondition');
    expect(code(() => williams(1))).toBe('squareSize');
    expect(code(() => allOrders(9))).toBe('ordersSize');
    expect(code(() => allocate(100, [500, -1], null))).toBe('stratumSize');
    expect(code(() => marginOfError(0.5, 100, 0.95, 50))).toBe('populationSmall');
    expect(code(() => designEffect(20, 2, 100))).toBe('iccRange');
    expect(code(() => drawSample([{ id: 'a', group: '', size: 1 }], 'simple', 2, 1n))).toBe('sampleTooLarge');
  });
});
