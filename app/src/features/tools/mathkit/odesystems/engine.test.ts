import { describe, expect, it } from 'vitest';
import { expm } from '../dense';
import { dopri45, fixedSteps } from '../integrators';
import { analyzeLinear, analyzeNonlinear, analyzeSecondOrder, classify, eigenvector } from './engine';
import { fundamentalMatrix } from './extra';

describe("classification of x' = A x", () => {
  it('A = [[0,1],[-2,-3]] has eigenvalues -1 and -2: a stable node', () => {
    const k = classify(0, 1, -2, -3);
    expect(k.kind).toBe('stableNode');
    expect(k.eigenvalues.map((e) => e[0]).sort((x, y) => x - y)).toEqual([-2, -1]);
  });
  it('A = [[1,2],[-2,1]] has 1 +/- 2i: an unstable spiral', () => {
    const k = classify(1, 2, -2, 1);
    expect(k.kind).toBe('unstableSpiral');
    expect(k.eigenvalues[0][0]).toBeCloseTo(1, 12);
    expect(Math.abs(k.eigenvalues[0][1])).toBeCloseTo(2, 12);
  });
  it('A = [[0,1],[-1,0]] has +/- i: a center', () => {
    expect(classify(0, 1, -1, 0).kind).toBe('center');
  });
  it('covers the saddle, star, improper node, and singular cases', () => {
    expect(classify(1, 2, 2, 1).kind).toBe('saddle');
    expect(classify(2, 0, 0, 2).kind).toBe('unstableStar');
    expect(classify(-2, 0, 0, -2).kind).toBe('stableStar');
    expect(classify(1, 1, 0, 1).kind).toBe('unstableImproper');
    expect(classify(-1, 1, 0, -1).kind).toBe('stableImproper');
    expect(classify(0, 1, 0, 0).kind).toBe('lineOfEquilibria');
    expect(classify(1, 1, 1, 1).kind).toBe('lineOfEquilibria');
    expect(classify(0, 0, 0, 0).kind).toBe('zeroMatrix');
    expect(classify(-1, 5, -5, -1).kind).toBe('stableSpiral');
  });
  it('eigenvectors satisfy A v = lambda v', () => {
    const [a, b, c, d] = [4, 1, 2, 3];
    for (const lambda of [2, 5]) {
      const v = eigenvector(a, b, c, d, lambda);
      expect(a * v[0] + b * v[1]).toBeCloseTo(lambda * v[0], 12);
      expect(c * v[0] + d * v[1]).toBeCloseTo(lambda * v[1], 12);
    }
  });
});

describe('the linear analysis', () => {
  it('draws curves that follow the matrix exponential', () => {
    const r = analyzeLinear(0, 1, -2, -3);
    expect(r.classification.stable).toBe('stable');
    expect(r.trajectories.length).toBeGreaterThan(8);
    expect(r.axes).toHaveLength(2);
    expect(r.steps.map((s) => s.key)).toContain('odeKind');
  });
  it("the second-order equation y'' + 3y' + 2y = 0 gives the same node", () => {
    const r = analyzeSecondOrder(3, 2);
    expect(r.classification.kind).toBe('stableNode');
    expect(r.steps[0].key).toBe('odeReduce');
  });
  it('the matrix exponential solves the system: a rotation for a center', () => {
    const E = expm([
      [0, Math.PI / 2],
      [-Math.PI / 2, 0],
    ]);
    expect(E[0][0]).toBeCloseTo(0, 12);
    expect(E[0][1]).toBeCloseTo(1, 12);
    expect(E[1][0]).toBeCloseTo(-1, 12);
  });
  it('rejects a matrix that is not numbers', () => {
    expect(() => analyzeLinear(NaN, 0, 0, 1)).toThrow();
  });
});

describe('nonlinear systems', () => {
  it('Lotka-Volterra has a saddle at the origin and a center of the linearization at (3, 2)', () => {
    const r = analyzeNonlinear('x*(1-0.5*y)', 'y*(-0.75+0.25*x)', [-1, 6, -1, 5]);
    expect(r.equilibria).toHaveLength(2);
    const [origin, other] = r.equilibria;
    expect(origin.x).toBeCloseTo(0, 9);
    expect(origin.classification.kind).toBe('saddle');
    expect(other.x).toBeCloseTo(3, 9);
    expect(other.y).toBeCloseTo(2, 9);
    expect(other.classification.kind).toBe('center');
    expect(other.inconclusive).toBe(true);
    expect(r.nullclines.f.length).toBeGreaterThan(10);
    expect(r.trajectories.length).toBeGreaterThan(5);
  });
  it('finds several equilibria of a pendulum-like system', () => {
    const r = analyzeNonlinear('y', '-sin(x)-0.5*y', [-4, 4, -2, 2]);
    expect(r.equilibria.map((e) => Math.round(e.x * 1000) / 1000)).toEqual([-3.142, 0, 3.142]);
    expect(r.equilibria[1].classification.kind).toBe('stableSpiral');
    expect(r.equilibria[0].classification.kind).toBe('saddle');
  });
  it('explains unreadable input', () => {
    expect(() => analyzeNonlinear('x*z', 'y')).toThrow();
    expect(() => analyzeNonlinear('x', 'y', [1, 1, 0, 1])).toThrow();
    expect(() => analyzeNonlinear('', 'y')).toThrow();
  });
});

describe('initial value solvers', () => {
  const f = (_t: number, y: readonly number[]) => [y[0]];
  it("Euler with h = 0.1 for y' = y gives 2.5937425 at t = 1; RK4 gives 2.7182797", () => {
    expect(fixedSteps('euler', f, 0, [1], 1, 0.1).at(-1)!.y[0]).toBeCloseTo(2.5937425, 7);
    expect(fixedSteps('rk4', f, 0, [1], 1, 0.1).at(-1)!.y[0]).toBeCloseTo(2.7182797, 7);
  });
  it('Heun is second order and the adaptive pair meets its tolerance', () => {
    const heun = fixedSteps('heun', f, 0, [1], 1, 0.1).at(-1)!.y[0];
    const finer = fixedSteps('heun', f, 0, [1], 1, 0.05).at(-1)!.y[0];
    expect(Math.abs(heun - Math.E) / Math.abs(finer - Math.E)).toBeCloseTo(4, 0);
    const adaptive = dopri45(f, 0, [1], 1, { rtol: 1e-10, atol: 1e-12 }).at(-1)!.y[0];
    expect(Math.abs(adaptive - Math.E)).toBeLessThan(1e-9);
  });
  it('backward Euler stays stable on a stiff problem where forward Euler explodes', () => {
    const stiff = (_t: number, y: readonly number[]) => [-1000 * y[0]];
    expect(Math.abs(fixedSteps('euler', stiff, 0, [1], 1, 0.01).at(-1)!.y[0])).toBeGreaterThan(1e6);
    const back = fixedSteps('backward-euler', stiff, 0, [1], 1, 0.01).at(-1)!.y[0];
    expect(Math.abs(back)).toBeLessThan(1e-6);
  });
  it('runs backward in time and rejects a bad step', () => {
    const back = dopri45(f, 1, [Math.E], 0, { rtol: 1e-10, atol: 1e-12 }).at(-1)!;
    expect(back.y[0]).toBeCloseTo(1, 8);
    expect(() => fixedSteps('rk4', f, 0, [1], 1, 0)).toThrow();
  });
});

describe('fundamental matrix, trace-determinant plane and limit cycles', () => {
  const cases: [string, number[]][] = [
    ['real distinct', [0, 1, -2, -3]],
    ['repeated, defective', [1, 1, 0, 1]],
    ['repeated, star', [-2, 0, 0, -2]],
    ['complex', [1, -2, 3, 1]],
    ['center', [0, 2, -2, 0]],
  ];
  it.each(cases)('e^(At) in closed form matches the matrix exponential: %s', (_name, [a, b, c, d]) => {
    const Phi = fundamentalMatrix(a, b, c, d);
    for (const t of [0, 0.3, 1, -0.7]) {
      const E = expm([
        [a * t, b * t],
        [c * t, d * t],
      ]);
      const P = Phi.at(t);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) expect(P[i][j]).toBeCloseTo(E[i][j], 9);
    }
    expect(Phi.latex.startsWith('e^{At}=')).toBe(true);
  });
  it('the linear analysis shows the fundamental matrix and the trace-determinant point on the parabola side', () => {
    const r = analyzeLinear(1, -2, 3, 1);
    expect(r.steps.some((s) => s.key === 'odeFundamental')).toBe(true);
    expect(r.traceDet.point).toEqual([2, 7]);
    // det = 7 is above trace^2 / 4 = 1, so the eigenvalues are complex.
    expect(r.traceDet.point[1]).toBeGreaterThan(r.traceDet.point[0] ** 2 / 4);
    expect(r.traceDet.parabola.every(([x, y]) => Math.abs(y - (x * x) / 4) < 1e-12)).toBe(true);
  });
  it('Van der Pol with mu = 1 has a stable limit cycle of amplitude 2.00862 and period 6.66338', () => {
    const r = analyzeNonlinear('y', '(1-x^2)*y-x', [-4, 4, -4, 4]);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0].stable).toBe(true);
    expect(r.cycles[0].crossing).toBeCloseTo(2.00862, 4);
    expect(r.cycles[0].period).toBeCloseTo(6.66338, 3);
    expect(r.steps.some((s) => s.key === 'odeLimitCycle')).toBe(true);
  });
  it('a center (a family of closed orbits) is not reported as a limit cycle', () => {
    expect(analyzeNonlinear('x*(1-0.5*y)', 'y*(-0.75+0.25*x)', [-1, 6, -1, 5]).cycles).toHaveLength(0);
    expect(analyzeNonlinear('y', '-x', [-3, 3, -3, 3]).cycles).toHaveLength(0);
  });
  it('a stable spiral has no limit cycle', () => {
    expect(analyzeNonlinear('-x-y', 'x-y', [-3, 3, -3, 3]).cycles).toHaveLength(0);
  });
});
