import { describe, expect, it } from 'vitest';
import { findRoot } from './roots';

describe('root finding', () => {
  it("finds the square root of 2 by Newton's method, quadratically", () => {
    const result = findRoot({ f: 'x^2 - 2', method: 'newton', x0: 1 });
    expect(result.outcome).toBe('converged');
    expect(result.root).toBeCloseTo(Math.SQRT2, 14);
    expect(result.order!).toBeGreaterThan(1.8);
    expect(result.rows[1].x).toBeCloseTo(1.5, 14);
    expect(result.graph.lines.length).toBeGreaterThan(4);
  });

  it('solves cos x = x three ways', () => {
    const want = 0.7390851332151607;
    for (const [method, x0, x1] of [
      ['newton', 1, undefined],
      ['bisection', 0, 1],
      ['secant', 0, 1],
    ] as const) {
      const result = findRoot({ f: 'cos(x) - x', method, x0, ...(x1 === undefined ? {} : { x1 }) });
      expect(result.outcome, method).toBe('converged');
      expect(result.root!).toBeCloseTo(want, 9);
    }
    const bisection = findRoot({ f: 'cos(x) - x', method: 'bisection', x0: 0, x1: 1 });
    expect(bisection.rows.length).toBeGreaterThan(25);
    expect(bisection.order!).toBeCloseTo(1, 1);
    const secant = findRoot({ f: 'cos(x) - x', method: 'secant', x0: 0, x1: 1 });
    expect(secant.rows.length).toBeLessThan(bisection.rows.length);
  });

  it("reports Newton's method running away from the cube root", () => {
    const result = findRoot({ f: 'cbrt(x)', method: 'newton', x0: 1 });
    expect(result.outcome).toBe('diverged');
    expect(result.rows[1].x).toBeCloseTo(-2, 12);
    expect(result.root).toBeNull();
  });

  it('reports arctangent diverging from a far start and converging from a near one', () => {
    expect(findRoot({ f: 'atan(x)', method: 'newton', x0: 2 }).outcome).toBe('diverged');
    expect(findRoot({ f: 'atan(x)', method: 'newton', x0: 0.5 }).outcome).toBe('converged');
  });

  it('reports a flat tangent, a cycle, and a missing sign change', () => {
    expect(findRoot({ f: 'x^2 - 1', method: 'newton', x0: 0 }).outcome).toBe('flat');
    expect(findRoot({ f: 'x^3 - 2*x + 2', method: 'newton', x0: 0 }).outcome).toBe('cycle');
    expect(findRoot({ f: 'x^2 + 1', method: 'bisection', x0: -1, x1: 1 }).outcome).toBe('noSignChange');
    expect(findRoot({ f: 'x^2 + 1', method: 'newton', x0: 0.5, maxIterations: 20 }).outcome).not.toBe('converged');
  });

  it('converges only linearly at a double root', () => {
    const result = findRoot({ f: '(x - 1)^2', method: 'newton', x0: 2, tolerance: 1e-8 });
    expect(result.outcome).toBe('converged');
    expect(result.order!).toBeLessThan(1.2);
  });

  it('converges at a repeated root from far away, and says the root is repeated', () => {
    const result = findRoot({ f: '(x - 1)^2', method: 'newton', x0: 3 });
    expect(result.outcome).toBe('converged');
    expect(result.root!).toBeCloseTo(1, 8);
    expect(result.steps.some((s) => s.key === 'rootMultiple')).toBe(true);
    expect(findRoot({ f: 'x^2 - 2', method: 'newton', x0: 1 }).steps.some((s) => s.key === 'rootMultiple')).toBe(false);
  });
});
