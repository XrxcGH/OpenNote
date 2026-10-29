import { describe, expect, it } from 'vitest';
import { compile, read } from './expr';
import {
  FOURIER_PAIRS,
  LAPLACE_PAIRS,
  fourier,
  inverseFourier,
  inverseLaplace,
  laplace,
  searchTable,
} from './transforms';

const at = (text: string, v: string, x: number) => compile(read(text), [v])([x]);

describe('Laplace transforms', () => {
  const cases: [string, (s: number) => number][] = [
    ['1', (s) => 1 / s],
    ['t^3', (s) => 6 / s ** 4],
    ['exp(-2*t)', (s) => 1 / (s + 2)],
    ['3*sin(2*t)', (s) => 6 / (s * s + 4)],
    ['cos(3*t) - 2*t', (s) => s / (s * s + 9) - 2 / (s * s)],
    ['t*sin(2*t)', (s) => (4 * s) / (s * s + 4) ** 2],
    ['exp(-t)*cos(2*t)', (s) => (s + 1) / ((s + 1) ** 2 + 4)],
    ['t^2*e^(3*t)', (s) => 2 / (s - 3) ** 3],
    ['sinh(2*t)', (s) => 2 / (s * s - 4)],
  ];
  for (const [f, want] of cases) {
    it(`transforms ${f} and checks it numerically`, () => {
      const result = laplace(f);
      expect(result.checked).toBe(true);
      expect(at(result.text.replace(/·/g, '*').replace(/π/g, 'pi'), 's', 5.5)).toBeCloseTo(want(5.5), 10);
    });
  }

  it('goes there and back again', () => {
    for (const [f] of cases) {
      const there = laplace(f);
      const back = inverseLaplace(there.text.replace(/·/g, '*'));
      expect(back.checked, `${f} -> ${there.text} -> ${back.text}`).toBe(true);
      for (const t of [0.3, 1.1, 2.5]) expect(at(back.text.replace(/·/g, '*'), 't', t)).toBeCloseTo(at(f, 't', t), 7);
    }
  });

  it('inverts partial fractions with real, repeated, and complex poles', () => {
    const real = inverseLaplace('1/((s+1)*(s+2))');
    expect(real.steps.map((s) => s.key)).toContain('inversePartial');
    for (const t of [0, 1, 2])
      expect(at(real.text.replace(/·/g, '*'), 't', t)).toBeCloseTo(Math.exp(-t) - Math.exp(-2 * t), 9);
    const repeated = inverseLaplace('1/(s+1)^2');
    expect(at(repeated.text.replace(/·/g, '*'), 't', 2)).toBeCloseTo(2 * Math.exp(-2), 9);
    const complex = inverseLaplace('(2*s + 3)/(s^2 + 2*s + 5)');
    // 2 e^(-t) cos 2t + (1/2) e^(-t) sin 2t
    for (const t of [0.4, 1.7])
      expect(at(complex.text.replace(/·/g, '*'), 't', t)).toBeCloseTo(
        Math.exp(-t) * (2 * Math.cos(2 * t) + 0.5 * Math.sin(2 * t)),
        9,
      );
  });

  it('reads a delay as a unit step', () => {
    const result = inverseLaplace('exp(-2*s)/s^2');
    expect(result.text).toContain('u(t − 2)');
    expect(result.checked).toBe(true);
    expect(result.graph.find((p) => Math.abs(p.x - 1) < 0.02)?.y).toBe(0);
  });

  it('refuses a term it has no rule for', () => {
    expect(() => laplace('ln(t)')).toThrow('laplace-term');
    expect(() => inverseLaplace('s^2/(s+1)')).toThrow('inverse-improper');
  });
});

describe('Fourier transforms', () => {
  it('matches table pairs and goes there and back again', () => {
    for (const f of ['exp(-2*abs(t))', '3*exp(-0.5*t^2)', '1/(4 + t^2)']) {
      const there = fourier(f);
      expect(there.checked, there.text).toBe(true);
      const back = inverseFourier(there.text.replace(/·/g, '*').replace(/ω/g, 'w').replace(/π/g, 'pi'));
      expect(back.checked, back.text).toBe(true);
      for (const t of [0, 0.7, 1.9])
        expect(at(back.text.replace(/·/g, '*').replace(/π/g, 'pi'), 't', t)).toBeCloseTo(at(f, 't', t), 8);
    }
  });

  it('gives the Gaussian its known transform', () => {
    const result = fourier('exp(-t^2)');
    expect(at(result.text.replace(/·/g, '*').replace(/ω/g, 'w').replace(/π/g, 'pi'), 'w', 1)).toBeCloseTo(
      Math.sqrt(Math.PI) * Math.exp(-0.25),
      10,
    );
  });

  it('searches the tables', () => {
    expect(searchTable(LAPLACE_PAIRS, 'sin').length).toBeGreaterThan(2);
    expect(searchTable(FOURIER_PAIRS, 'a|t|').map((p) => p.id)).toContain('expAbs');
    expect(searchTable(LAPLACE_PAIRS, 'zzz')).toEqual([]);
  });
});
