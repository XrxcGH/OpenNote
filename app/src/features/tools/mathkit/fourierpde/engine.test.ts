import { describe, expect, it } from 'vitest';
import { eigenpairs, fourierSeries, readPieces, recognizePattern, solveBvp, solveLaplace } from './engine';

const SQUARE = '-1 ; -pi ; 0\n1 ; 0 ; pi';

describe('Fourier series', () => {
  it('the odd square wave has b_n = 4/(n pi) for odd n and 0 for even n', () => {
    const r = fourierSeries(SQUARE, 'full', Math.PI, 30);
    r.b.forEach((b, i) => {
      const n = i + 1;
      expect(b).toBeCloseTo(n % 2 === 1 ? 4 / (n * Math.PI) : 0, 10);
    });
    r.a.forEach((a) => expect(Math.abs(a)).toBeLessThan(1e-10));
    expect(r.bPattern?.latex).toBe('b_n=\\begin{cases}\\frac{4}{n\\pi}&n\\text{ odd}\\\\0&n\\text{ even}\\end{cases}');
    expect(r.aPattern?.latex).toBe('a_n=0');
  });
  it('f(x) = x on (-pi, pi) has b_n = 2(-1)^(n+1)/n', () => {
    const r = fourierSeries('x', 'full', Math.PI, 20);
    r.b.forEach((b, i) => expect(b).toBeCloseTo((2 * (i % 2 === 0 ? 1 : -1)) / (i + 1), 10));
    expect(r.bPattern?.latex).toBe('b_n=(-1)^{n+1}\\frac{2}{n}');
  });
  it('satisfies Parseval and shows the Gibbs overshoot of about 9 percent of the jump', () => {
    const r = fourierSeries('x', 'full', Math.PI, 200);
    expect(r.parseval.integral).toBeCloseTo((2 * Math.PI ** 2) / 3, 10);
    expect(Math.abs(r.parseval.series / r.parseval.integral - 1)).toBeLessThan(6e-3);
    const g = fourierSeries(SQUARE, 'full', Math.PI, 60).gibbs!;
    expect(g.jump).toBeCloseTo(2, 12);
    expect(g.overshoot / g.jump).toBeGreaterThan(0.0885);
    expect(g.overshoot / g.jump).toBeLessThan(0.0905);
  });
  it('builds half-range sine and cosine series', () => {
    const sine = fourierSeries('1', 'sine', Math.PI, 15);
    sine.b.forEach((b, i) => expect(b).toBeCloseTo((i + 1) % 2 === 1 ? 4 / ((i + 1) * Math.PI) : 0, 10));
    const cosine = fourierSeries('x', 'cosine', Math.PI, 15);
    expect(cosine.a0).toBeCloseTo(Math.PI, 12);
    expect(cosine.a[0]).toBeCloseTo(-4 / Math.PI, 10);
    expect(cosine.a[1]).toBeCloseTo(0, 10);
    expect(cosine.partial(1.2, 15)).toBeCloseTo(1.2, 1);
  });
  it('the partial sum converges to the function away from jumps', () => {
    const r = fourierSeries(SQUARE, 'full', Math.PI, 100);
    expect(r.partial(1.5)).toBeCloseTo(1, 2);
    expect(r.partial(-1.5)).toBeCloseTo(-1, 2);
    expect(r.partial(0)).toBeCloseTo(0, 12);
  });
  it('explains bad input', () => {
    expect(() => fourierSeries('x', 'full', 0, 5)).toThrow();
    expect(() => fourierSeries('x', 'full', Math.PI, 0)).toThrow();
    expect(() => readPieces('1 ; 0 ; 1', -1, 1)).toThrow(); // a gap
    expect(() => readPieces('1 ; -1 ; 0.5\n2 ; 0 ; 1', -1, 1)).toThrow(); // an overlap
    expect(() => readPieces('1 ; 1', -1, 1)).toThrow();
    expect(() => readPieces('q', -1, 1)).toThrow();
  });
  it('recognizes only simple closed forms', () => {
    expect(recognizePattern([1, 0.3, 0.7, 0.11, 0.9, 0.2], 'b_n')).toBeNull();
    expect(recognizePattern([1, 0.25, 1 / 9, 1 / 16, 1 / 25, 1 / 36], 'a_n')?.latex).toBe('a_n=\\frac{1}{n^{2}}');
  });
});

describe('eigenfunctions', () => {
  it('has the standard eigenvalues for each pair of conditions', () => {
    expect(eigenpairs('DD', 2, 3).map((p) => p.mu)).toEqual([Math.PI / 2, Math.PI, (3 * Math.PI) / 2]);
    expect(eigenpairs('NN', 2, 3).map((p) => p.mu)).toEqual([0, Math.PI / 2, Math.PI]);
    expect(eigenpairs('DN', 1, 2).map((p) => p.mu)).toEqual([Math.PI / 2, (3 * Math.PI) / 2]);
    expect(eigenpairs('ND', 1, 2).map((p) => p.mu)).toEqual([Math.PI / 2, (3 * Math.PI) / 2]);
  });
  it('finds the Robin roots of tan(mu) = -mu', () => {
    const [first, second] = eigenpairs('DR', 1, 2, 1);
    expect(first.mu).toBeCloseTo(2.0287578381, 9);
    expect(second.mu).toBeCloseTo(4.9131804394, 9);
    expect(() => eigenpairs('DR', 1, 2, -1)).toThrow();
  });
});

describe('heat and wave equations', () => {
  const base = { conditions: 'DD' as const, L: 1, speed: 0.5, terms: 12, times: [0, 0.1] };
  it('u(x, 0) = sin(pi x / L) decays as exp(-alpha (pi/L)^2 t) sin(pi x / L)', () => {
    const r = solveBvp({ ...base, equation: 'heat', initial: 'sin(pi*x)' });
    for (const [x, t] of [
      [0.3, 0.1],
      [0.5, 0.7],
    ]) {
      expect(r.at(x, t)).toBeCloseTo(Math.exp(-0.5 * Math.PI ** 2 * t) * Math.sin(Math.PI * x), 12);
    }
    expect(r.coefficients[0]).toBeCloseTo(1, 12);
    expect(Math.abs(r.coefficients[1])).toBeLessThan(1e-12);
  });
  it('a parabola gives c_n = 8 / (n pi)^3 for odd n', () => {
    const r = solveBvp({ ...base, equation: 'heat', initial: 'x*(1-x)' });
    expect(r.coefficients[0]).toBeCloseTo(8 / Math.PI ** 3, 12);
    expect(r.coefficients[2]).toBeCloseTo(8 / (3 * Math.PI) ** 3, 12);
    expect(r.at(0.5, 0)).toBeCloseTo(0.25, 3);
  });
  it('insulated ends conserve the mean', () => {
    const r = solveBvp({ ...base, conditions: 'NN', equation: 'heat', initial: 'cos(2*pi*x)+0.5' });
    expect(r.at(0.2, 0.05)).toBeCloseTo(Math.exp(-0.5 * (2 * Math.PI) ** 2 * 0.05) * Math.cos(0.4 * Math.PI) + 0.5, 10);
  });
  it('a plucked string follows u = cos(c pi t) sin(pi x)', () => {
    const r = solveBvp({ ...base, equation: 'wave', speed: 2, initial: 'sin(pi*x)', velocity: '0' });
    expect(r.at(0.4, 0.3)).toBeCloseTo(Math.cos(2 * Math.PI * 0.3) * Math.sin(Math.PI * 0.4), 12);
    const hit = solveBvp({ ...base, equation: 'wave', speed: 1, initial: '0', velocity: 'sin(pi*x)' });
    expect(hit.at(0.5, 0.25)).toBeCloseTo(Math.sin(Math.PI * 0.25) / Math.PI, 10);
  });
  it('rejects a speed that is not positive', () => {
    expect(() => solveBvp({ ...base, equation: 'heat', speed: 0, initial: 'x' })).toThrow();
    expect(() => solveBvp({ ...base, equation: 'heat', terms: 0, initial: 'x' })).toThrow();
  });
});

describe('Laplace equation on a rectangle', () => {
  it('with sin(pi x) on the top of the unit square the center is sinh(pi/2)/sinh(pi) = 0.199268', () => {
    const r = solveLaplace(1, 1, 'top', 'sin(pi*x)', 20);
    expect(r.at(0.5, 0.5)).toBeCloseTo(Math.sinh(Math.PI / 2) / Math.sinh(Math.PI), 10);
    expect(r.at(0.5, 0.5)).toBeCloseTo(0.199268, 6);
    expect(r.at(0.3, 1)).toBeCloseTo(Math.sin(0.3 * Math.PI), 10);
    expect(r.at(0.3, 0)).toBeCloseTo(0, 12);
    expect(r.at(0, 0.6)).toBeCloseTo(0, 12);
  });
  it('gives the same center for any side by symmetry', () => {
    for (const side of ['bottom', 'left', 'right'] as const) {
      expect(solveLaplace(1, 1, side, 'sin(pi*x)', 20).at(0.5, 0.5)).toBeCloseTo(0.199268, 6);
    }
  });
  it('is harmonic: a numerical Laplacian is near zero inside', () => {
    const r = solveLaplace(2, 1, 'top', 'x*(2-x)', 40);
    const h = 1e-3;
    const [x, y] = [0.7, 0.4];
    const lap = (r.at(x + h, y) + r.at(x - h, y) + r.at(x, y + h) + r.at(x, y - h) - 4 * r.at(x, y)) / (h * h);
    expect(Math.abs(lap)).toBeLessThan(1e-3);
  });
  it('rejects bad sizes', () => {
    expect(() => solveLaplace(0, 1, 'top', '1', 5)).toThrow();
  });
});
