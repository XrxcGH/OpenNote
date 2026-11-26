import './text';
import { describe, expect, it } from 'vitest';
import { bracketScan, brent, dopri, generalizedEigen, solve, symEigen, wrap } from './num';

describe('mechanisms numerics', () => {
  it('integrates y = e^-t and a harmonic oscillator to tight tolerance', () => {
    const decay = dopri((_, y) => [-y[0]], 0, [1], 3, { rtol: 1e-10, atol: 1e-12 });
    expect(decay.y.at(-1)![0]).toBeCloseTo(Math.exp(-3), 9);
    const sho = dopri((_, y) => [y[1], -y[0]], 0, [1, 0], 10, { rtol: 1e-10, atol: 1e-12 });
    expect(sho.y.at(-1)![0]).toBeCloseTo(Math.cos(10), 8);
  });

  it('locates an event inside a step', () => {
    const run = dopri((_, y) => [y[1], -y[0]], 0, [1, 0], 10, { rtol: 1e-10, events: [(_, y) => y[0]], terminal: 0 });
    expect(run.events[0].t).toBeCloseTo(Math.PI / 2, 8);
  });

  it('finds roots with Brent and a bracket scan', () => {
    expect(brent(Math.cos, 0, 3)).toBeCloseTo(Math.PI / 2, 12);
    expect(brent(Math.cos, 0, 1)).toBeNull();
    expect(bracketScan(Math.sin, 0.5, 10)).toHaveLength(3);
  });

  it('solves linear systems and reports singular ones', () => {
    expect(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ),
    ).toEqual([expect.closeTo(0.8, 12), expect.closeTo(1.4, 12)]);
    expect(
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });

  it('finds symmetric and generalized eigenpairs', () => {
    const e = symEigen([
      [2, -1],
      [-1, 2],
    ]);
    expect(e.values[0]).toBeCloseTo(1, 12);
    expect(e.values[1]).toBeCloseTo(3, 12);
    const g = generalizedEigen(
      [
        [6, -2],
        [-2, 4],
      ],
      [
        [2, 0],
        [0, 1],
      ],
    )!;
    // det(K - l M) = (6 - 2l)(4 - l) - 4 = 2l^2 - 14l + 20 = 0, so l = 2 and 5.
    expect(g.values[0]).toBeCloseTo(2, 10);
    expect(g.values[1]).toBeCloseTo(5, 10);
    const v = g.vectors.map((row) => row[0]);
    expect(2 * v[0] ** 2 + v[1] ** 2).toBeCloseTo(1, 10);
    expect(generalizedEigen([[1]], [[0]])).toBeNull();
  });

  it('wraps angles into (-pi, pi]', () => {
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrap(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});
