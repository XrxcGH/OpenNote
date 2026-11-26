import '../text';
import { describe, expect, it } from 'vitest';
import { composite, differentiate, quadrature, rombergTable } from './calculus';
import { dft, fft, nonlinearFit, polyfit, polynomialFit, spectrum } from './fit';
import { interpolate, newtonCoefficients, readPoints } from './interp';
import { iterativeSolve, newtonSolve } from './linsolve';
import { solveBvp, solveIvp, thomas } from './ode';
import { solvePoisson, solveHeat2d, heatStepLimit } from './pde';
import { gaussLegendre } from '../numeric';

describe('interpolation', () => {
  it('the natural spline through (0,0), (1,1), (2,0) is 0.6875 at 0.5', () => {
    expect(interpolate('0,0\n1,1\n2,0', 'natural', 0.5).value).toBeCloseTo(0.6875, 12);
  });
  it('a spline passes through its points and is smooth where the pieces meet', () => {
    const r = interpolate('0 1\n1 3\n2 2\n3 5\n4 4', 'natural', 2);
    expect(r.value).toBeCloseTo(2, 12);
    const h = 1e-6;
    expect((r.evaluate(1 + h) - r.evaluate(1 - h)) / (2 * h)).toBeCloseTo(
      (r.evaluate(1 + 2 * h) - r.evaluate(1 - 2 * h)) / (4 * h),
      5,
    );
  });
  it('a clamped spline matches a cubic exactly when given the right end slopes', () => {
    // f(x) = x^3 - 2x on 0..3 has slopes -2 and 25 at the ends.
    const pts = [0, 1, 2, 3].map((x) => `${x}, ${x ** 3 - 2 * x}`).join('\n');
    const r = interpolate(pts, 'clamped', 1.5, -2, 25);
    expect(r.value).toBeCloseTo(1.5 ** 3 - 3, 12);
  });
  it('Lagrange and Newton agree and reproduce the polynomial through the points', () => {
    const pts = '0, 1\n1, 2\n2, 9\n3, 28'; // x^3 + 1
    const a = interpolate(pts, 'lagrange', 1.5);
    const b = interpolate(pts, 'newton', 1.5);
    expect(a.value).toBeCloseTo(1.5 ** 3 + 1, 12);
    expect(b.value).toBeCloseTo(1.5 ** 3 + 1, 12);
    newtonCoefficients(readPoints(pts)).forEach((c, i) => expect(c).toBeCloseTo([1, 0, 0, 1][i], 12));
  });
  it('rejects repeated x, too few points, and a spline outside its points', () => {
    expect(() => readPoints('1, 2\n1, 3')).toThrow();
    expect(() => readPoints('1, 2')).toThrow();
    expect(() => interpolate('0,0\n1,1\n2,0', 'natural', 5)).toThrow();
  });
});

describe('numerical differentiation', () => {
  it('the central difference of sin at 1 is cos 1 to second order, Richardson to many digits', () => {
    const r = differentiate('sin(x)', 1, 0.1);
    expect(r.exact).toBeCloseTo(Math.cos(1), 14);
    expect(r.best).toBeCloseTo(Math.cos(1), 9);
  });
  it('the second derivative of x^4 at 2 is 48', () => {
    expect(differentiate('x^4', 2, 0.1, 2).best).toBeCloseTo(48, 7);
  });
  it('rejects a zero step', () => {
    expect(() => differentiate('x', 1, 0)).toThrow();
  });
});

describe('numerical integration', () => {
  it('Simpson with 4 panels on e^x over 0..1 is 1.7183188', () => {
    const r = quadrature('exp(x)', 0, 1, 4, 'simpson');
    expect(r.value).toBeCloseTo(1.7183188, 7);
    expect(r.reference).toBeCloseTo(Math.E - 1, 12);
  });
  it('matches a hand sum of the trapezoid rule', () => {
    const f = (x: number) => x * x;
    expect(composite('trapezoid', f, 0, 1, 4)).toBeCloseTo((0 + 2 * (1 / 16 + 1 / 4 + 9 / 16) + 1) / 8, 14);
  });
  it('the left and right sums bracket an increasing function', () => {
    const f = (x: number) => x;
    expect(composite('left', f, 0, 1, 10)).toBeCloseTo(0.45, 14);
    expect(composite('right', f, 0, 1, 10)).toBeCloseTo(0.55, 14);
    expect(composite('midpoint', f, 0, 1, 10)).toBeCloseTo(0.5, 14);
  });
  it('3-point Gauss-Legendre integrates x^4 on -1..1 to 2/5 exactly, and x^6 not', () => {
    expect(composite('gauss', (x) => x ** 4, -1, 1, 3)).toBeCloseTo(0.4, 14);
    expect(Math.abs(composite('gauss', (x) => x ** 6, -1, 1, 3) - 2 / 7)).toBeGreaterThan(1e-3);
    const { x, w } = gaussLegendre(3);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(2, 14);
    expect(x[1]).toBeCloseTo(0, 14);
  });
  it('Romberg reaches a high order on e^x', () => {
    const R = rombergTable(Math.exp, 0, 1, 5);
    expect(R[4][4]).toBeCloseTo(Math.E - 1, 11);
  });
  it('shows an observed order of about 2 for the trapezoid rule and 4 for Simpson', () => {
    const t = quadrature('sin(x)', 0, 3, 16, 'trapezoid');
    expect(
      t.lines.some((l) => l.key === 'quadOrder' && Math.abs(Number(l.vars!.observed.replace('−', '-')) - 2) < 0.1),
    ).toBe(true);
    const s = quadrature('sin(x)', 0, 3, 16, 'simpson');
    expect(
      s.lines.some((l) => l.key === 'quadOrder' && Math.abs(Number(l.vars!.observed.replace('−', '-')) - 4) < 0.2),
    ).toBe(true);
  });
  it('rejects an odd Simpson count, a repeated limit, and a function undefined on the interval', () => {
    expect(() => quadrature('x', 0, 1, 3, 'simpson')).toThrow();
    expect(() => quadrature('x', 1, 1, 4, 'trapezoid')).toThrow();
    expect(() => quadrature('1/x', 0, 1, 4, 'trapezoid')).toThrow();
  });
});

describe('initial value problems', () => {
  it("Euler with h = 0.1 on y' = y to t = 1 is 1.1^10, and RK4 is 2.7182797", () => {
    const e = solveIvp({ f: 'y', t0: 0, y0: 1, tEnd: 1, h: 0.1, method: 'euler' });
    expect(e.final).toBeCloseTo(1.1 ** 10, 12);
    expect(e.final).toBeCloseTo(2.5937425, 7);
    const r = solveIvp({ f: 'y', t0: 0, y0: 1, tEnd: 1, h: 0.1, method: 'rk4' });
    expect(r.final).toBeCloseTo(2.7182797, 7);
  });
  it('shows the orders 1, 2 and 4 for Euler, Heun and RK4', () => {
    for (const [method, order] of [
      ['euler', 1],
      ['heun', 2],
      ['rk4', 4],
    ] as const) {
      const r = solveIvp({ f: 'y', exact: 'exp(t)', t0: 0, y0: 1, tEnd: 1, h: 0.1, method });
      const l = r.lines.find((x) => x.key === 'ivpOrder')!;
      expect(Math.abs(Number(l.vars!.observed.replace('−', '-')) - order)).toBeLessThan(0.15);
    }
  });
  it('adaptive RK45 is accurate', () => {
    const r = solveIvp({ f: '-2*t*y', exact: 'exp(-t^2)', t0: 0, y0: 1, tEnd: 2, h: 0.1, method: 'rk45' });
    expect(Math.abs(r.final - Math.exp(-4))).toBeLessThan(1e-8);
  });
  it('backward Euler is stable on a stiff problem where Euler blows up', () => {
    const stiff = { f: '-50*(y-cos(t))', t0: 0, y0: 0, tEnd: 1, h: 0.1 };
    const be = solveIvp({ ...stiff, method: 'backward-euler' });
    expect(Math.abs(be.final)).toBeLessThan(2);
    expect(() => solveIvp({ ...stiff, method: 'euler', h: 0.1, tEnd: 100 })).toThrow();
  });
  it('rejects a zero step and a huge step count', () => {
    expect(() => solveIvp({ f: 'y', t0: 0, y0: 1, tEnd: 1, h: 0, method: 'euler' })).toThrow();
    expect(() => solveIvp({ f: 'y', t0: 0, y0: 1, tEnd: 1e9, h: 1, method: 'euler' })).toThrow();
  });
});

describe('boundary value problems', () => {
  it("y'' + y = 0 with y(0) = 0, y(pi/2) = 1 gives sin x by both methods", () => {
    for (const method of ['difference', 'shooting'] as const) {
      const r = solveBvp({
        p: '0',
        q: '1',
        r: '0',
        a: 0,
        b: Math.PI / 2,
        alpha: 0,
        beta: 1,
        n: 200,
        method,
        exact: 'sin(x)',
      });
      const error = Number(r.lines.find((l) => l.key === 'bvpError')!.vars!.error.replace('−', '-'));
      expect(error).toBeLessThan(method === 'difference' ? 1e-4 : 1e-8);
    }
  });
  it('the Thomas solver agrees with a hand solution', () => {
    // [2 -1 0; -1 2 -1; 0 -1 2] x = [1 0 1] has x = [1 1 1]
    const x = thomas([0, -1, -1], [2, 2, 2], [-1, -1, 0], [1, 0, 1]);
    x.forEach((v) => expect(v).toBeCloseTo(1, 14));
  });
});

describe('iterative solvers', () => {
  const A = '4 -1 0\n-1 4 -1\n0 -1 4';
  const b = '15, 10, 10';
  it('Jacobi, Gauss-Seidel and SOR reach the direct solution', () => {
    // Direct: 4x - y = 15, -x + 4y - z = 10, -y + 4z = 10 -> x = 4.4107..., y = 2.6428..., z = 3.1607...
    const y = (10 + 15 / 4 + 10 / 4) / (4 - 1 / 4 - 1 / 4);
    const x = (15 + y) / 4;
    const z = (10 + y) / 4;
    const exact = [x, y, z];
    for (const method of ['jacobi', 'gauss-seidel', 'sor'] as const) {
      const r = iterativeSolve({ A, b, method, omega: 1.1, tolerance: 1e-12, maxIterations: 500 });
      expect(r.converged).toBe(true);
      r.x.forEach((v, i) => expect(v).toBeCloseTo(exact[i], 9));
      expect(r.radius).toBeLessThan(1);
    }
  });
  it('Gauss-Seidel needs fewer iterations than Jacobi, with about the square of the radius', () => {
    const j = iterativeSolve({ A, b, method: 'jacobi', omega: 1, tolerance: 1e-10, maxIterations: 500 });
    const g = iterativeSolve({ A, b, method: 'gauss-seidel', omega: 1, tolerance: 1e-10, maxIterations: 500 });
    expect(g.iterations).toBeLessThan(j.iterations);
    expect(g.radius).toBeCloseTo(j.radius ** 2, 6);
  });
  it('reports a method that diverges and a zero on the diagonal', () => {
    const r = iterativeSolve({
      A: '1 3\n4 1',
      b: '1, 1',
      method: 'jacobi',
      omega: 1,
      tolerance: 1e-9,
      maxIterations: 60,
    });
    expect(r.converged).toBe(false);
    expect(r.radius).toBeGreaterThan(1);
    expect(() =>
      iterativeSolve({ A: '0 1\n1 1', b: '1, 1', method: 'jacobi', omega: 1, tolerance: 1e-9, maxIterations: 10 }),
    ).toThrow();
  });
});

describe("Newton's method for systems", () => {
  it('solves x^2 + y^2 = 4, xy = 1 from (2, 0.5) to (1.9318517, 0.5176381)', () => {
    const r = newtonSolve({ equations: 'x^2+y^2=4\nx*y=1', unknowns: 'x, y', start: '2, 0.5', tolerance: 1e-13 });
    expect(r.converged).toBe(true);
    expect(r.root[0]).toBeCloseTo(2 * Math.cos(Math.PI / 12), 10);
    expect(r.root[1]).toBeCloseTo(2 * Math.sin(Math.PI / 12), 10);
    expect(r.root[0]).toBeCloseTo(1.9318517, 7);
    expect(r.root[1]).toBeCloseTo(0.5176381, 7);
  });
  it('rejects a mismatched system and an unknown name', () => {
    expect(() => newtonSolve({ equations: 'x^2=4', unknowns: 'x, y', start: '1, 1', tolerance: 1e-9 })).toThrow();
    expect(() => newtonSolve({ equations: 'x+z=4', unknowns: 'x', start: '1', tolerance: 1e-9 })).toThrow();
  });
  it('reports a singular Jacobian instead of a root', () => {
    const r = newtonSolve({ equations: 'x^2=1', unknowns: 'x', start: '0', tolerance: 1e-9 });
    expect(r.converged).toBe(false);
  });
});

describe('grids', () => {
  const zero = { top: '0', bottom: '0', left: '0', right: '0' };
  it('Laplace with the top edge at 100 and the others at 0 has 25 at the center of an odd grid', () => {
    for (const n of [5, 9, 11]) {
      const r = solvePoisson({
        nx: n,
        ny: n,
        width: 1,
        height: 1,
        edges: { ...zero, top: '100' },
        source: '0',
        tolerance: 1e-12,
      });
      expect(r.grid[(n - 1) / 2][(n - 1) / 2]).toBeCloseTo(25, 6);
    }
  });
  it('Poisson u_xx + u_yy = -2 pi^2 sin(pi x) sin(pi y) is solved to the grid accuracy', () => {
    const n = 21;
    const r = solvePoisson({
      nx: n,
      ny: n,
      width: 1,
      height: 1,
      edges: zero,
      source: '-2*pi^2*sin(pi*x)*sin(pi*y)',
      tolerance: 1e-13,
    });
    expect(Math.abs(r.grid[10][10] - 1)).toBeLessThan(0.01);
  });
  it('the 2D heat equation decays the fundamental mode by exp(-2 alpha pi^2 t)', () => {
    const n = 21;
    const alpha = 1;
    const hx = 1 / (n - 1);
    const dt = heatStepLimit(alpha, hx, hx) * 0.9;
    const r = solveHeat2d({
      nx: n,
      ny: n,
      width: 1,
      height: 1,
      alpha,
      edges: { top: '0', bottom: '0', left: '0', right: '0' },
      initial: 'sin(pi*x)*sin(pi*y)',
      dt,
      tEnd: 0.02,
    });
    expect(r.grid[10][10]).toBeCloseTo(Math.exp(-2 * Math.PI ** 2 * 0.02), 2);
  });
  it('refuses a step past the stability limit and a grid that is too small', () => {
    expect(() =>
      solveHeat2d({
        nx: 11,
        ny: 11,
        width: 1,
        height: 1,
        alpha: 1,
        edges: { top: '0', bottom: '0', left: '0', right: '0' },
        initial: '1',
        dt: 0.1,
        tEnd: 1,
      }),
    ).toThrow();
    expect(() =>
      solvePoisson({ nx: 2, ny: 2, width: 1, height: 1, edges: zero, source: '0', tolerance: 1e-9 }),
    ).toThrow();
  });
});

describe('fitting and the transform', () => {
  it('the least-squares line through (0,1), (1,3), (2,4), (3,4) is y = 1.5 + 1.0 x', () => {
    const c = polyfit([0, 1, 2, 3], [1, 3, 4, 4], 1);
    expect(c[0]).toBeCloseTo(1.5, 12);
    expect(c[1]).toBeCloseTo(1, 12);
  });
  it('recovers an exact quadratic and reports R squared 1', () => {
    const r = polynomialFit([0, 1, 2, 3, 4].map((x) => `${x}, ${2 - x + 0.5 * x * x}`).join('\n'), 2);
    expect(r.parameters[0]).toBeCloseTo(2, 11);
    expect(r.parameters[1]).toBeCloseTo(-1, 11);
    expect(r.parameters[2]).toBeCloseTo(0.5, 11);
    expect(r.r2).toBeCloseTo(1, 12);
  });
  it('fits an exponential model from a rough start', () => {
    const data = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((x) => `${x}, ${2 * Math.exp(0.7 * x)}`).join('\n');
    const r = nonlinearFit({ source: data, model: 'a*exp(b*x)', names: 'a, b', start: '1, 0.3' });
    expect(r.parameters[0]).toBeCloseTo(2, 6);
    expect(r.parameters[1]).toBeCloseTo(0.7, 6);
  });
  it('the FFT equals the direct DFT and obeys Parseval', () => {
    const x = [1, 2, 0, -1, 3, 0.5, -2, 4];
    const { re, im } = fft(x, new Array<number>(8).fill(0));
    for (let k = 0; k < 8; k++) {
      let sr = 0;
      let si = 0;
      x.forEach((v, n) => {
        sr += v * Math.cos((2 * Math.PI * k * n) / 8);
        si -= v * Math.sin((2 * Math.PI * k * n) / 8);
      });
      expect(re[k]).toBeCloseTo(sr, 12);
      expect(im[k]).toBeCloseTo(si, 12);
    }
    const energy = x.reduce((s, v) => s + v * v, 0);
    expect(re.reduce((s, v, k) => s + v * v + im[k] * im[k], 0) / 8).toBeCloseTo(energy, 10);
  });
  it('finds a 50 Hz tone of amplitude 2 sampled at 800 Hz', () => {
    const samples = Array.from({ length: 256 }, (_, n) => 2 * Math.sin((2 * Math.PI * 50 * n) / 800)).join(', ');
    const r = spectrum(samples, 800);
    expect(r.peak.frequency).toBeCloseTo(50, 6);
    expect(r.peak.amplitude).toBeCloseTo(2, 6);
  });
  it('finds the 2 Hz component of 1, 0, -1, 1, 0, -1 at 6 Hz exactly, with amplitude 2/sqrt(3)', () => {
    // By hand: the pattern (1, 0, -1) repeats twice, X_2 = 2 (1 - e^{-4 pi i / 3}) = 3 - sqrt(3) i, and the
    // amplitude is 2 |X_2| / 6 = 2 sqrt(12) / 6 = 2/sqrt(3).
    const r = spectrum('1, 0, -1, 1, 0, -1', 6);
    expect(r.peak.frequency).toBeCloseTo(2, 12);
    expect(r.peak.amplitude).toBeCloseTo(1.1547005383792515, 10);
    expect(r.size).toBe(6);
  });
  it('a tone with a whole number of periods in a non-power-of-two record has no leakage', () => {
    const x = Array.from({ length: 100 }, (_, n) => 3 * Math.cos((2 * Math.PI * 7 * n) / 100 + 0.4));
    const r = spectrum(x.join(', '), 100);
    expect(r.peak.frequency).toBeCloseTo(7, 10);
    expect(r.peak.amplitude).toBeCloseTo(3, 10);
    const rest = r.magnitude.filter((_, k) => k !== 7);
    expect(Math.max(...rest)).toBeLessThan(1e-10);
  });
  it('the exact transform of any length agrees with the O(n^2) sum', () => {
    const x = [3, -1, 4, 1, -5, 9, 2];
    const { re, im } = dft(x, new Array<number>(7).fill(0));
    for (let k = 0; k < 7; k++) {
      const sr = x.reduce((s, v, n) => s + v * Math.cos((2 * Math.PI * k * n) / 7), 0);
      const si = x.reduce((s, v, n) => s - v * Math.sin((2 * Math.PI * k * n) / 7), 0);
      expect(re[k]).toBeCloseTo(sr, 10);
      expect(im[k]).toBeCloseTo(si, 10);
    }
  });
  it('rejects a bad rate', () => {
    expect(spectrum('1, 2, 3, 4, 5', 10).size).toBe(5);
    expect(() => spectrum('1, 2, 3', 0)).toThrow();
  });
});
