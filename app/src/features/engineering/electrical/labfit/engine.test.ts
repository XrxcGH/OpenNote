import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import {
  chiSquareP,
  gammaQ,
  levenbergMarquardt,
  linearFit,
  lineSums,
  parseData,
  polynomialBasis,
  predict,
  rSquared,
} from './engine';
import type { Data } from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

const WEIGHTED: Data = { x: [1, 2, 3, 4, 5], y: [2.9, 5.1, 7.0, 9.2, 10.9], sigma: [0.1, 0.1, 0.2, 0.2, 0.3] };

describe('reading the data table', () => {
  it('reads rows split by spaces, commas, or tabs, and skips a header and comments', () => {
    const d = parseData('x, y, sigma\n# comment\n1, 2, 0.1\n2\t3\t0.2\n3 4 0.3');
    expect(d.x).toEqual([1, 2, 3]);
    expect(d.y).toEqual([2, 3, 4]);
    expect(d.sigma).toEqual([0.1, 0.2, 0.3]);
  });
  it('reads data without uncertainties as sigma null', () => {
    expect(parseData('1 2\n2 4\n3 7').sigma).toBeNull();
  });
  it('names the line of a mistake', () => {
    const line = (text: string): string => {
      try {
        parseData(text);
      } catch (error) {
        return (error as { vars: Record<string, string> }).vars.line ?? 'none';
      }
      return 'no error';
    };
    expect(line('1 2\n2 x')).toBe('2');
    expect(line('1 2 0.1\n2 3')).toBe('2');
    expect(line('1 2 0\n2 3 0.1')).toBe('1');
    expect(line('1 2 3 4\n')).toBe('1');
    expect(() => parseData('1 2')).toThrow();
    expect(() => parseData('')).toThrow();
  });
});

describe('weighted straight line', () => {
  it('x 1..5 with sigmas: a 0.91138 (0.12862), b 2.05094 (0.05549), chi2 2.2105, reduced 0.73683', () => {
    const f = linearFit((x) => [1, x], WEIGHTED);
    close(f.coef[0]!, 0.91138, 1e-4);
    close(Math.sqrt(f.cov[0]![0]!), 0.12862, 1e-4);
    close(f.coef[1]!, 2.05094, 1e-4);
    close(Math.sqrt(f.cov[1]![1]!), 0.05549, 1e-4);
    close(f.chi2, 2.2105, 1e-4);
    close(f.chi2 / f.dof, 0.73683, 1e-4);
    expect(f.dof).toBe(3);
    expect(f.scaled).toBe(false);
  });
  it('the QR fit agrees with the closed-form weighted sums', () => {
    const f = linearFit((x) => [1, x], WEIGHTED);
    const s = lineSums(WEIGHTED);
    close(f.coef[0]!, s.intercept, 1e-12);
    close(f.coef[1]!, s.slope, 1e-12);
    close(Math.sqrt(f.cov[0]![0]!), s.uIntercept, 1e-12);
    close(Math.sqrt(f.cov[1]![1]!), s.uSlope, 1e-12);
    // The covariance of intercept and slope is -Sx / delta.
    close(f.cov[0]![1]!, -s.sx / s.delta, 1e-10);
  });
  it('p-value of chi2 2.2105 with 3 degrees of freedom, by numerical integration of the chi-square density', () => {
    const chi = 2.2105;
    const top = Math.sqrt(chi);
    const n = 20000;
    let area = 0;
    for (let k = 0; k <= n; k++) {
      const u = (top * k) / n;
      const w = k === 0 || k === n ? 1 : k % 2 === 1 ? 4 : 2;
      area += w * ((2 * u * u * Math.exp((-u * u) / 2)) / (2 ** 1.5 * (Math.sqrt(Math.PI) / 2)));
    }
    area *= top / n / 3;
    close(chiSquareP(chi, 3), 1 - area, 1e-6);
  });
  it('gamma Q has the closed forms for 2 and 4 degrees of freedom, and the 5 % point of 3', () => {
    close(chiSquareP(5, 2), Math.exp(-2.5), 1e-12);
    close(chiSquareP(7, 4), Math.exp(-3.5) * (1 + 3.5), 1e-12);
    close(chiSquareP(7.815, 3), 0.05, 1e-3);
    expect(gammaQ(1, 0)).toBe(1);
  });
  it('R squared is 1 for a perfect line and 0 for a flat fit to scattered data', () => {
    expect(rSquared([1, 2, 3], [1, 2, 3])).toBe(1);
    close(rSquared([1, 2, 3], [2, 2, 2]), 1e-300 + 0, 1);
  });
});

describe('fits without uncertainties', () => {
  const data: Data = { x: [1, 2, 3, 4, 5, 6], y: [3.1, 4.9, 7.2, 8.8, 11.1, 13.0], sigma: null };
  it('scales the covariance by the scatter, as the textbook formula does', () => {
    const f = linearFit((x) => [1, x], data);
    expect(f.scaled).toBe(true);
    const n = 6;
    const mean = 3.5;
    const sxx = data.x.reduce((s, x) => s + (x - mean) ** 2, 0);
    const slope = data.x.reduce((s, x, i) => s + (x - mean) * data.y[i]!, 0) / sxx;
    const res = data.y.reduce((s, y, i) => s + (y - (f.coef[0]! + slope * data.x[i]!)) ** 2, 0);
    close(f.coef[1]!, slope, 1e-12);
    close(Math.sqrt(f.cov[1]![1]!), Math.sqrt(res / (n - 2) / sxx), 1e-10);
  });
  it('with equal sigmas the covariance is sigma^2 / Sxx', () => {
    const eq: Data = { ...data, sigma: data.x.map(() => 0.5) };
    const f = linearFit((x) => [1, x], eq);
    close(Math.sqrt(f.cov[1]![1]!), 0.5 / Math.sqrt(17.5), 1e-12);
  });
  it('refuses a fit with no points to spare when the scatter is the only error estimate', () => {
    expect(() => linearFit((x) => [1, x], { x: [1, 2], y: [1, 2], sigma: null })).toThrow();
  });
});

describe('polynomial fits', () => {
  it('recovers an exact quadratic', () => {
    const x = [-2, -1, 0, 1, 2, 3];
    const y = x.map((v) => 1.5 - 2 * v + 0.25 * v * v);
    const f = linearFit(polynomialBasis(2), { x, y, sigma: x.map(() => 0.1) });
    close(f.coef[0]!, 1.5, 1e-10);
    close(f.coef[1]!, -2, 1e-10);
    close(f.coef[2]!, 0.25, 1e-10);
    expect(f.chi2).toBeLessThan(1e-18);
  });
  it('refuses repeated x values for a line, and more parameters than points', () => {
    expect(() => linearFit((x) => [1, x], { x: [2, 2, 2], y: [1, 2, 3], sigma: null })).toThrow();
    expect(() => linearFit(polynomialBasis(3), { x: [1, 2, 3], y: [1, 2, 3], sigma: [1, 1, 1] })).toThrow();
  });
  it('survives large numbers', () => {
    const x = [1e6, 2e6, 3e6, 4e6];
    const f = linearFit((v) => [1, v], { x, y: x.map((v) => 2e12 + 3e6 * v), sigma: null });
    close(f.coef[1]!, 3e6, 1e-9);
  });
});

describe('Levenberg-Marquardt', () => {
  const x = [0, 1, 2, 3, 4, 5];
  it('recovers 3 and -0.5 from exact y = 3 e^(-0.5 x)', () => {
    const data: Data = { x, y: x.map((v) => 3 * Math.exp(-0.5 * v)), sigma: null };
    const f = levenbergMarquardt((v, p) => p[0]! * Math.exp(p[1]! * v), data, [1, -0.1]);
    close(f.coef[0]!, 3, 1e-8);
    close(f.coef[1]!, -0.5, 1e-8);
  });
  it('finds a 3-parameter decay with an offset from a poor start', () => {
    const data: Data = {
      x: [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6],
      y: [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6].map((v) => 2 * Math.exp(-v / 1.5) + 0.5),
      sigma: null,
    };
    const f = levenbergMarquardt((v, p) => p[0]! * Math.exp(-v / p[1]!) + p[2]!, data, [1, 1, 0]);
    close(f.coef[0]!, 2, 1e-6);
    close(f.coef[1]!, 1.5, 1e-6);
    close(f.coef[2]!, 0.5, 1e-6);
  });
  it('gives the same answer and covariance as the linear fit when the model is a line', () => {
    const lin = linearFit((v) => [1, v], WEIGHTED);
    const nl = levenbergMarquardt((v, p) => p[0]! + p[1]! * v, WEIGHTED, [0, 1]);
    close(nl.coef[0]!, lin.coef[0]!, 1e-7);
    close(nl.coef[1]!, lin.coef[1]!, 1e-7);
    close(nl.cov[1]![1]!, lin.cov[1]![1]!, 1e-5);
    close(nl.chi2, lin.chi2, 1e-9);
  });
  it('refuses a model that is not a number at a data point', () => {
    expect(() =>
      levenbergMarquardt((v, p) => Math.log(v) * p[0]!, { x: [0, 1, 2], y: [1, 2, 3], sigma: null }, [1]),
    ).toThrow();
  });
});

describe('predicting from a fit', () => {
  it('uses the covariance: u^2 = ua^2 + x^2 ub^2 + 2 x cov(a, b)', () => {
    const f = linearFit((v) => [1, v], WEIGHTED);
    const r = predict((v, p) => p[0]! + p[1]! * v, f.coef, f.cov, 3.5);
    close(r.y, f.coef[0]! + 3.5 * f.coef[1]!, 1e-12);
    close(r.u ** 2, f.cov[0]![0]! + 3.5 ** 2 * f.cov[1]![1]! + 2 * 3.5 * f.cov[0]![1]!, 1e-8);
  });
});

describe('the fitting tool form', () => {
  const base = initialValues(spec);
  it('answers every model on suitable data', () => {
    const exp = { data: '0 3\n1 1.8196\n2 1.1036\n3 0.6694\n4 0.4060\n5 0.2463' };
    const pow = { data: '1 2\n2 5.6569\n3 10.3923\n4 16\n5 22.3607' };
    expect(runTool(spec, base).ok).toBe(true);
    expect(runTool(spec, { ...base, model: 'poly', degree: '2' }).ok).toBe(true);
    expect(runTool(spec, { ...base, ...exp, model: 'exponential' }).ok).toBe(true);
    expect(runTool(spec, { ...base, ...exp, model: 'expLinear' }).ok).toBe(true);
    expect(runTool(spec, { ...base, ...pow, model: 'powerlaw' }).ok).toBe(true);
    expect(runTool(spec, { ...base, ...pow, model: 'powerLinear' }).ok).toBe(true);
    const custom = { ...base, ...exp, model: 'custom', expression: 'a*exp(-x/b)', start: '3, 2' };
    expect(runTool(spec, custom).ok).toBe(true);
  });
  it('recovers the power law y = 2 x^1.5 both ways', () => {
    const data = [1, 2, 3, 4, 5].map((v) => `${v} ${2 * v ** 1.5}`).join('\n');
    for (const model of ['powerlaw', 'powerLinear']) {
      const r = runTool(spec, { ...base, data, model });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const a = r.rows.find((row) => row.key === 'parameter' && row.vars?.name === 'a')!;
        const b = r.rows.find((row) => row.key === 'parameter' && row.vars?.name === 'b')!;
        expect(Number(a.value.split(' ')[0]!.replace('−', '-'))).toBeCloseTo(2, 3);
        expect(Number(b.value.split(' ')[0]!.replace('−', '-'))).toBeCloseTo(1.5, 3);
      }
    }
  });
  it('shows tiny parameters instead of zero, and a header after a comment line', () => {
    const data = '# my data\nx y\n' + [1, 2, 3, 4].map((v) => `${v} ${(2e-16 * v ** 2).toExponential(6)}`).join('\n');
    const r = runTool(spec, { ...base, data, model: 'powerlaw' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.rows.find((row) => row.key === 'parameter' && row.vars?.name === 'a')!;
      expect(Number(a.value.split(' ')[0]!.replace('−', '-'))).toBeCloseTo(2e-16, 20);
      expect(a.value.startsWith('0 ')).toBe(false);
    }
  });
  it('labels the power-law a in y over x to the b and fits the linearised chi-square in y space', () => {
    const data = '1 2.1\n2 5.5\n3 10.6\n4 15.8\n5 22.7';
    const r = runTool(spec, { ...base, data, model: 'powerLinear', xUnit: 'm', yUnit: 'N' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.rows.find((row) => row.key === 'parameter' && row.vars?.name === 'a')!;
      expect(a.value).toContain('N/m^b');
      // Independent chi-square: unweighted sum of squared y residuals about the fitted curve.
      const lx = [1, 2, 3, 4, 5].map(Math.log);
      const ly = [2.1, 5.5, 10.6, 15.8, 22.7].map(Math.log);
      const mx = lx.reduce((u, v) => u + v) / 5;
      const my = ly.reduce((u, v) => u + v) / 5;
      const b = lx.reduce((u, v, i) => u + (v - mx) * (ly[i]! - my), 0) / lx.reduce((u, v) => u + (v - mx) ** 2, 0);
      const aa = Math.exp(my - b * mx);
      const chi2 = [1, 2, 3, 4, 5].reduce((u, v, i) => u + ([2.1, 5.5, 10.6, 15.8, 22.7][i]! - aa * v ** b) ** 2, 0);
      const row = r.rows.find((row2) => row2.key === 'chiSquare')!;
      expect(Number(row.value.replace('−', '-'))).toBeCloseTo(chi2, 3);
    }
  });
  it('propagates a formula in the fitted parameters with the covariance: 1/b and a + 3b', () => {
    const rows = '1 2.9 0.1,2 5.1 0.1,3 7.0 0.2,4 9.2 0.2,5 10.9 0.3'.split(',').join(String.fromCharCode(10));
    const run = (derived: string) => {
      const r = runTool(spec, { ...base, data: rows, derived });
      if (!r.ok) throw new Error(r.error);
      const row = r.rows.find((x) => x.key === 'derivedRow')!;
      const [value, u] = row.value
        .replace(/−/g, '-')
        .split('±')
        .map((t) => Number(t.trim().split(' ')[0]));
      return { value: value!, u: u! };
    };
    // Slope 2.05094 +/- 0.05549 (checked by hand elsewhere): u(1/b) = u_b / b^2.
    const inverse = run('1/b');
    close(inverse.value, 1 / 2.05094, 1e-4);
    close(inverse.u, 0.05549 / 2.05094 ** 2, 2e-3);
    // The prediction at x = 3 is a + 3b, and its uncertainty uses the negative covariance of a and b.
    const sum = run('a + 3*b');
    close(sum.value, 0.91138 + 3 * 2.05094, 1e-4);
    const independent = Math.hypot(0.12862, 3 * 0.05549);
    expect(sum.u).toBeLessThan(independent);
    expect(runTool(spec, { ...base, data: rows, derived: 'z + 1' }).ok).toBe(false);
  });
  it('names the problem: bad data, bad expression, logs of non-positive numbers, bad degree', () => {
    expect(runTool(spec, { ...base, data: '1 x' }).ok).toBe(false);
    expect(runTool(spec, { ...base, model: 'custom', expression: 'a*(' }).ok).toBe(false);
    expect(runTool(spec, { ...base, model: 'custom', expression: '3*x' }).ok).toBe(false);
    expect(runTool(spec, { ...base, model: 'expLinear', data: '1 -2\n2 3\n3 4' }).ok).toBe(false);
    expect(runTool(spec, { ...base, model: 'poly', degree: '0' }).ok).toBe(false);
    expect(runTool(spec, { ...base, xnew: 'zzz' }).ok).toBe(false);
  });
  it('predicts at a new x and reports units', () => {
    const r = runTool(spec, { ...base, xnew: '6', xUnit: 's', yUnit: 'm' });
    expect(r.ok && r.rows.some((row) => row.key === 'prediction')).toBe(true);
  });
});
