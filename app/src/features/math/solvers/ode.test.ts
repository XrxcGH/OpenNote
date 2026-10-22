import { describe, expect, it } from 'vitest';
import { solveOde, type OdeInput } from './ode';

/** Ten textbook problems and more, each with its known solution. */
const PROBLEMS: { name: string; input: OdeInput; want: (x: number) => number }[] = [
  {
    name: "y' = xy, y(0) = 1",
    input: { kind: 'separable', rhs: 'x*y', x0: 0, y0: 1, from: -2, to: 2 },
    want: (x) => Math.exp((x * x) / 2),
  },
  {
    name: "Newton's cooling y' = -0.5(y - 20), y(0) = 100",
    input: { kind: 'separable', rhs: '-0.5*(y - 20)', x0: 0, y0: 100, from: 0, to: 10 },
    want: (x) => 20 + 80 * Math.exp(-0.5 * x),
  },
  {
    name: "y' = x/y, y(0) = 2",
    input: { kind: 'separable', rhs: 'x/y', x0: 0, y0: 2, from: -3, to: 3 },
    want: (x) => Math.sqrt(x * x + 4),
  },
  {
    name: "y' = y^2, y(0) = 1",
    input: { kind: 'separable', rhs: 'y^2', x0: 0, y0: 1, from: -2, to: 0.9 },
    want: (x) => 1 / (1 - x),
  },
  {
    name: "y' + 2y = 4, y(0) = 0",
    input: { kind: 'linear', p: '2', q: '4', x0: 0, y0: 0, from: 0, to: 3 },
    want: (x) => 2 - 2 * Math.exp(-2 * x),
  },
  {
    name: "y' + y = x, y(0) = 1",
    input: { kind: 'linear', p: '1', q: 'x', x0: 0, y0: 1, from: -1, to: 4 },
    want: (x) => x - 1 + 2 * Math.exp(-x),
  },
  {
    name: "y' + y/x = x, y(1) = 1",
    input: { kind: 'linear', p: '1/x', q: 'x', x0: 1, y0: 1, from: 0.5, to: 3 },
    want: (x) => (x * x) / 3 + 2 / (3 * x),
  },
  {
    name: "y'' + 4y = 0",
    input: { kind: 'second', a: '1', b: '0', c: '4', x0: 0, y0: 1, v0: 0, from: -3, to: 3 },
    want: (x) => Math.cos(2 * x),
  },
  {
    name: "y'' - 3y' + 2y = 0",
    input: { kind: 'second', a: '1', b: '-3', c: '2', x0: 0, y0: 0, v0: 1, from: -1, to: 1 },
    want: (x) => Math.exp(2 * x) - Math.exp(x),
  },
  {
    name: "y'' + 2y' + y = 0",
    input: { kind: 'second', a: '1', b: '2', c: '1', x0: 0, y0: 1, v0: 0, from: 0, to: 5 },
    want: (x) => (1 + x) * Math.exp(-x),
  },
  {
    name: "y'' + y = sin x, resonance",
    input: { kind: 'second', a: '1', b: '0', c: '1', g: 'sin(x)', x0: 0, y0: 0, v0: 0, from: 0, to: 6 },
    want: (x) => (Math.sin(x) - x * Math.cos(x)) / 2,
  },
  {
    name: "y'' - y = e^(2x)",
    input: { kind: 'second', a: '1', b: '0', c: '-1', g: 'exp(2*x)', x0: 0, y0: 0, v0: 0, from: -1, to: 1 },
    want: (x) => Math.exp(2 * x) / 3 - Math.exp(x) / 2 + Math.exp(-x) / 6,
  },
  {
    name: "y'' + 3y' + 2y = 4x",
    input: { kind: 'second', a: '1', b: '3', c: '2', g: '4*x', x0: 0, y0: 0, v0: 0, from: 0, to: 3 },
    want: (x) => 2 * x - 3 + 4 * Math.exp(-x) - Math.exp(-2 * x),
  },
  {
    name: "y'' + 2y' + 5y = 0, damped",
    input: { kind: 'second', a: '1', b: '2', c: '5', x0: 0, y0: 1, v0: -1, from: 0, to: 4 },
    want: (x) => Math.exp(-x) * Math.cos(2 * x),
  },
];

describe('differential equations', () => {
  for (const problem of PROBLEMS) {
    it(`solves ${problem.name} by hand`, () => {
      const result = solveOde(problem.input);
      expect(result.solution, result.steps.map((s) => `${s.key} ${s.math}`).join('\n')).not.toBeNull();
      for (const x of [problem.input.from, (problem.input.from + problem.input.to) / 2, problem.input.to]) {
        expect(result.exact!(x)).toBeCloseTo(problem.want(x), 6);
      }
      for (const p of result.curve) expect(p.y).toBeCloseTo(problem.want(p.x), 4);
      expect(result.field.length).toBeGreaterThan(100);
    });
  }

  it('draws a phase plane for a second-order equation', () => {
    const result = solveOde(PROBLEMS[7].input);
    // y = cos 2x, y' = -2 sin 2x: the phase path is the ellipse y^2 + (y'/2)^2 = 1.
    for (const p of result.phase) expect(p.x ** 2 + (p.y / 2) ** 2).toBeCloseTo(1, 6);
  });

  it('falls back to the numeric solution when the integral has no rule', () => {
    const result = solveOde({ kind: 'separable', rhs: 'exp(-x^2)', x0: 0, y0: 0, from: 0, to: 2 });
    expect(result.solution).toBeNull();
    expect(result.steps.at(-1)?.key).toBe('odeNumericOnly');
    // y(2) = (sqrt(pi)/2) erf(2)
    expect(result.curve.at(-1)!.y).toBeCloseTo(0.882081390762422, 8);
  });

  it('says when an equation is not separable', () => {
    expect(() => solveOde({ kind: 'separable', rhs: 'x + y', x0: 0, y0: 0, from: 0, to: 1 })).toThrow('not-separable');
  });
});
