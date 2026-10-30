import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { curvedBeam, shrinkFit, thickCylinder, thinVessel } from './engine';
import { vesselsSpec } from './spec';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const near = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const code = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof SolidsError ? error.code : 'other';
  }
  return 'none';
};
/** The midpoint rule with many slices, as an independent integral. */
const integrate = (f: (x: number) => number, a: number, b: number, n = 20000) => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(a + ((i + 0.5) * (b - a)) / n);
  return (sum * (b - a)) / n;
};

describe('thin-walled vessels', () => {
  it('gives the validation tank 100 and 50 MPa', () => {
    const r = thinVessel('cylinder', 2e6, 0.5, 0.01);
    near(r.hoop, 100e6, 1e-9 * 100e6);
    near(r.axial, 50e6, 1e-9 * 50e6);
    rel(thinVessel('sphere', 2e6, 0.5, 0.01).hoop, 50e6, 1e-12);
    rel(r.ratio, 0.02, 1e-12);
  });

  it('agrees with Lamé as the wall gets thin', () => {
    const lame = thickCylinder({ ri: 1, ro: 1.001, pi: 1e6, po: 0, ends: 'closed' });
    rel(lame.hoop(1.0005), thinVessel('cylinder', 1e6, 1.0005, 0.001).hoop, 1e-3);
  });

  it('names what is wrong', () => {
    expect(code(() => thinVessel('cylinder', 1, 0.01, 0.01))).toBe('tooThick');
    expect(code(() => thinVessel('cylinder', 1, 0.5, 0))).toBe('positive');
    expect(code(() => thinVessel('cylinder', NaN, 0.5, 0.01))).toBe('notFinite');
  });
});

describe('thick-walled cylinders', () => {
  it('gives the validation case at both faces', () => {
    const r = thickCylinder({ ri: 0.05, ro: 0.1, pi: 100e6, po: 0, ends: 'closed' });
    rel(r.hoop(0.05), 166.67e6, 1e-4);
    rel(r.hoop(0.05), 500e6 / 3, 1e-12);
    rel(r.radial(0.05), -100e6, 1e-12);
    rel(r.hoop(0.1), 200e6 / 3, 1e-12);
    near(r.radial(0.1), 0, 1e-6);
    rel(r.axial, (100e6 * 0.05 ** 2) / (0.1 ** 2 - 0.05 ** 2), 1e-12);
    // Half the cylinder in equilibrium: ∫σθ dr through the wall carries pi ri − po ro.
    rel(integrate(r.hoop, 0.05, 0.1), 100e6 * 0.05, 1e-7);
  });

  it('gives −2 po ro²/(ro² − ri²) at the bore under outside pressure, and no axial stress with open ends', () => {
    const r = thickCylinder({ ri: 0.05, ro: 0.1, pi: 0, po: 10e6, ends: 'open' });
    rel(r.hoop(0.05), (-2 * 10e6 * 0.01) / (0.01 - 0.0025), 1e-12);
    expect(r.axial).toBe(0);
    const solid = thickCylinder({ ri: 0, ro: 0.1, pi: 0, po: 10e6, ends: 'open' });
    rel(solid.hoop(0.03), -10e6, 1e-12);
  });

  it('gives the radial displacement from Hooke’s law', () => {
    const r = thickCylinder({ ri: 0.05, ro: 0.1, pi: 100e6, po: 0, ends: 'closed', E: 200e9, nu: 0.3 });
    const [s, rr, a] = [r.hoop(0.05), r.radial(0.05), r.axial];
    rel(r.u?.(0.05), (0.05 / 200e9) * (s - 0.3 * (rr + a)), 1e-12);
  });

  it('names what is wrong', () => {
    expect(code(() => thickCylinder({ ri: 0.1, ro: 0.1, pi: 1, po: 0, ends: 'open' }))).toBe('innerRadius');
    expect(code(() => thickCylinder({ ri: 0, ro: 0.1, pi: 1, po: 0, ends: 'open' }))).toBe('solidInnerPressure');
    expect(code(() => thickCylinder({ ri: -1, ro: 0.1, pi: 1, po: 0, ends: 'open' }))).toBe('notNegative');
    const withE = { ri: 0.05, ro: 0.1, pi: 1, po: 0, ends: 'open' as const, E: 1e9 };
    expect(code(() => thickCylinder({ ...withE, nu: 0.6 }))).toBe('poisson');
  });
});

describe('press and shrink fits', () => {
  const steel = { Ei: 200e9, nui: 0.3, Eo: 200e9, nuo: 0.3 };

  it('gives the validation case: 75 MPa and 125 MPa at the bore', () => {
    const r = shrinkFit({ a: 0, b: 0.025, c: 0.05, delta: 0.025e-3, ...steel, mu: 0.15, length: 0.04, alpha: 12e-6 });
    rel(r.p, 75e6, 1e-6);
    rel(r.hubBore, 125e6, 1e-6);
    rel(r.shaftSurface, -75e6, 1e-6);
    rel(r.shaftInside, -75e6, 1e-6);
    rel(r.hubGrows + r.shaftShrinks, 0.025e-3, 1e-12);
    rel(r.torque, 2 * Math.PI * 0.15 * 75e6 * 0.025 ** 2 * 0.04, 1e-6);
    rel(r.heat, 0.025e-3 / (12e-6 * 0.025), 1e-12);
  });

  it('closes the interference for different materials and a bored shaft', () => {
    const fit = { a: 0.01, b: 0.03, c: 0.06, delta: 0.02e-3, Ei: 200e9, nui: 0.29, Eo: 71e9, nuo: 0.33 };
    const r = shrinkFit(fit);
    // Independent: Lamé displacements of each part under p, in plane stress.
    const hub = thickCylinder({ ri: 0.03, ro: 0.06, pi: r.p, po: 0, ends: 'open', E: 71e9, nu: 0.33 });
    const shaft = thickCylinder({ ri: 0.01, ro: 0.03, pi: 0, po: r.p, ends: 'open', E: 200e9, nu: 0.29 });
    rel((hub.u?.(0.03) ?? NaN) - (shaft.u?.(0.03) ?? NaN), 0.02e-3, 1e-10);
    rel(r.shaftInside, shaft.hoop(0.01), 1e-12);
    rel(r.hubOutside, hub.hoop(0.06), 1e-12);
  });

  it('names what is wrong', () => {
    const fit = { a: 0, b: 0.025, c: 0.05, delta: 1e-5, ...steel };
    expect(code(() => shrinkFit({ ...fit, c: 0.02 }))).toBe('fitRadii');
    expect(code(() => shrinkFit({ ...fit, a: 0.025 }))).toBe('fitRadii');
    expect(code(() => shrinkFit({ ...fit, delta: 0 }))).toBe('positive');
    expect(code(() => shrinkFit({ ...fit, nuo: 0.5 }))).toBe('poisson');
  });
});

describe('curved beams', () => {
  it('gives the validation rectangle', () => {
    const r = curvedBeam({ kind: 'strips', strips: [{ b: 0.02, r1: 0.05, r2: 0.1 }] }, 1e3);
    rel(r.rn, 72.135e-3, 1e-4);
    rel(r.rn, 0.05 / Math.log(2), 1e-12);
    rel(r.e, 2.8652e-3, 1e-4);
    rel(r.inner, 154.5e6, 1e-4);
    rel(r.outer, -97.25e6, 1e-4);
  });

  it('balances N and M through the depth of a tee', () => {
    const strips = [
      { b: 0.06, r1: 0.05, r2: 0.06 },
      { b: 0.01, r1: 0.06, r2: 0.11 },
    ];
    const [M, N] = [1e3, 5e3];
    const r = curvedBeam({ kind: 'strips', strips }, M, N);
    const width = (x: number) => (x < 0.06 ? 0.06 : 0.01);
    near(
      integrate((x) => r.stress(x) * width(x), 0.05, 0.06) + integrate((x) => r.stress(x) * width(x), 0.06, 0.11),
      N,
      1e-4 * N,
    );
    const moment = (a: number, b: number) => integrate((x) => r.stress(x) * width(x) * (r.rc - x), a, b);
    rel(moment(0.05, 0.06) + moment(0.06, 0.11), M, 1e-6);
  });

  it('gives a round section the textbook neutral axis', () => {
    const r = curvedBeam({ kind: 'circle', d: 0.04, rc: 0.06 }, 500);
    rel(r.rn, (Math.sqrt(0.08) + Math.sqrt(0.04)) ** 2 / 4, 1e-12);
  });

  it('tends to the straight beam when the curve is gentle', () => {
    const r = curvedBeam({ kind: 'strips', strips: [{ b: 0.02, r1: 10, r2: 10.05 }] }, 1e3);
    rel(r.inner, r.straightInner, 3e-3);
    rel(r.straightInner, (6 * 1e3) / (0.02 * 0.05 ** 2), 1e-9);
  });

  it('names what is wrong', () => {
    expect(code(() => curvedBeam({ kind: 'circle', d: 0.04, rc: 0.02 }, 1))).toBe('curvedRadius');
    expect(code(() => curvedBeam({ kind: 'strips', strips: [{ b: 0.02, r1: 0.1, r2: 0.05 }] }, 1))).toBe(
      'curvedRadius',
    );
    expect(code(() => curvedBeam({ kind: 'strips', strips: [] }, 1))).toBe('noParts');
    expect(code(() => curvedBeam({ kind: 'strips', strips: [{ b: 0.02, r1: 0.05, r2: 0.1 }] }, NaN))).toBe('notFinite');
  });
});

describe('the vessels form', () => {
  it('runs the first values and marks a pressure typed as a length', () => {
    expect(runTool(vesselsSpec, firstTexts(vesselsSpec), 'us').ok).toBe(true);
    const r = runTool(vesselsSpec, { ...firstTexts(vesselsSpec), pi: '100 mm' }, 'si');
    expect(r.ok ? 'none' : r.fields.map((one) => one.error.code).join()).toBe('unitMismatch');
    const bad = runTool(
      vesselsSpec,
      { ...firstTexts(vesselsSpec), mode: 'curved', section: 'strips', strips: '1 2' },
      'si',
    );
    expect(bad.ok ? 'none' : bad.error?.code).toBe('stripLine');
  });
});
