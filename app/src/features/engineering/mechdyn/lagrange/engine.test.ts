/* eslint-disable opennote/feature-boundaries -- The tests hand the engines the math feature's algebra directly. */
import { describe, expect, it } from 'vitest';
import { LAGRANGE_DEFAULTS, LAGRANGE_TEMPLATES, nameLatex, solveLagrange, type LagrangeInput } from './engine';
import { simplest, substitute } from '../../../math/calculus/algebra';
import { derivativeOf } from '../../../math/calculus/derivative';
import { latexOf } from '../../../math/calculus/print';
import { provideSymbolic } from '../symbolic';

provideSymbolic({ derivativeOf, latexOf, simplest, substitute });

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const double: LagrangeInput = { template: 'double', ...LAGRANGE_TEMPLATES.double, duration: 20 };

describe('Lagrangian mechanics', () => {
  it('simple pendulum: theta ddot = -(g/L) sin theta', () => {
    const r = ok(
      solveLagrange({
        ...LAGRANGE_DEFAULTS,
        params: [
          ['m', 2],
          ['L', 1.5],
          ['g', 9.81],
        ],
        duration: 1,
      }),
    );
    // Symbolic equality checked at many points: the derived acceleration is -(g/L) sin(theta) for any rate.
    for (let k = 0; k < 40; k += 1) {
      const th = -3 + 0.15 * k,
        thd = Math.sin(k);
      expect(r.accel([th], [thd], 0)![0]).toBeCloseTo((-9.81 / 1.5) * Math.sin(th), 12);
    }
    expect(r.explicit).toContain(String.raw`\sin`);
    expect(r.explicit).toContain(String.raw`\ddot{\theta}`);
  });

  it('pendulum released from 90 deg: period over small-angle period', () => {
    const r = ok(solveLagrange({ ...LAGRANGE_DEFAULTS, duration: 4 }));
    expect(Math.abs(r.periodRatio! - 1.18034)).toBeLessThan(1e-5);
    // Independent: 4 K(1/2) / (2 pi) with K(1/2) = 1.854074677301372 (complete elliptic integral, m = 1/2).
    expect(r.periodRatio!).toBeCloseTo((4 * 1.854074677301372) / (2 * Math.PI), 7);
    expect(r.equilibria[0].stable).toBe(true);
    expect(r.equilibria[0].omegas![0]).toBeCloseTo(Math.sqrt(9.81), 6);
    expect(r.equilibria.some((e) => !e.stable && Math.abs(Math.abs(e.q[0]) - Math.PI) < 1e-6)).toBe(true);
  });
});

describe('systems with more coordinates', () => {
  it('double pendulum: energy drift over 20 s', () => {
    const r = ok(solveLagrange(double));
    expect(r.energyDrift!).toBeLessThan(1e-6);
    // Independent: textbook equations of motion for equal masses and lengths, compared at one state.
    const [t1, t2, w1, w2] = [0.7, -0.4, 1.1, -0.6];
    const g = 9.81,
      d = t1 - t2;
    const den = 3 - Math.cos(2 * d);
    const a1 =
      (-g * 3 * Math.sin(t1) - g * Math.sin(t1 - 2 * t2) - 2 * Math.sin(d) * (w2 * w2 + w1 * w1 * Math.cos(d))) / den;
    const a2 = (2 * Math.sin(d) * (2 * w1 * w1 + 2 * g * Math.cos(t1) + w2 * w2 * Math.cos(d))) / den;
    const a = r.accel([t1, t2], [w1, w2], 0)!;
    expect(a[0]).toBeCloseTo(a1, 10);
    expect(a[1]).toBeCloseTo(a2, 10);
  });

  it('spring pendulum and cart-pendulum have stable equilibria with two frequencies', () => {
    const s = ok(solveLagrange({ template: 'spring', ...LAGRANGE_TEMPLATES.spring, duration: 2 }));
    const hang = s.equilibria.find((e) => e.stable)!;
    expect(hang.q[0]).toBeCloseTo(1 + 9.81 / 40, 8);
    expect(hang.omegas!.map((w) => w * w).sort((x, y) => x - y)[1]).toBeCloseTo(40, 6);
    const c = ok(solveLagrange({ template: 'cart', ...LAGRANGE_TEMPLATES.cart, duration: 2 }));
    expect(c.equilibria[0].stable).toBe(true);
    expect(c.energyDrift!).toBeLessThan(1e-7);
  });

  it('a generalized force enters the equation', () => {
    const r = ok(solveLagrange({ ...LAGRANGE_DEFAULTS, forces: ['-0.5*th_dot'], duration: 1 }));
    expect(r.accel([0.3], [2], 0)![0]).toBeCloseTo(-9.81 * Math.sin(0.3) - 0.5 * 2, 12);
    expect(r.energyDrift).toBeNull();
  });
});

describe('names and impossible input', () => {
  it('writes names as LaTeX', () => {
    expect(nameLatex('th1_dot')).toBe(String.raw`{\dot{\theta}_{1}}`);
    expect(nameLatex('m2')).toBe('{m_{2}}');
    expect(nameLatex('x_ddot')).toBe(String.raw`{\ddot{x}}`);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, T: '1/2*m*L^2*th_dot^' })).toEqual({ ok: false, error: 'lagrangeT' });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, V: 'q*th' })).toMatchObject({ ok: false, error: 'exprUnknown' });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, T: 'm*g*cos(th)' })).toEqual({
      ok: false,
      error: 'lagrangeMassSingular',
    });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, V: 'th_dot^2' })).toEqual({ ok: false, error: 'lagrangeVelocityInV' });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, T: 'th_dot^4' })).toEqual({
      ok: false,
      error: 'lagrangeNotQuadratic',
    });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, coords: ['th', 'th'], q0: [0, 0], qd0: [0, 0] })).toEqual({
      ok: false,
      error: 'lagrangeNames',
    });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, coords: [] })).toEqual({ ok: false, error: 'lagrangeCoords' });
    expect(solveLagrange({ ...LAGRANGE_DEFAULTS, params: [['th', 1]] })).toEqual({ ok: false, error: 'lagrangeNames' });
  });
});
