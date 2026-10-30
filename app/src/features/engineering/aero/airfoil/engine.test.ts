// Airfoils against independent results: the planned cases (computed apart with SciPy), more digits from a separate
// Python panel code (scratch panel.py), NACA's tabulated five-digit constants against their definitions, and the
// vortex panel method against the exact Joukowski airfoil.
import { describe, expect, it } from 'vitest';
import { AeroError, DEG, brent } from '../common';
import { airfoil } from './engine';
import { customSection, halfThickness, panelNodes, parseNaca, surfaceAt } from './geometry';
import { vortexPanel } from './panel';
import { camberIntegral, thinAirfoil } from './thin';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (error) {
    if (error instanceof AeroError) return error.code;
    throw error;
  }
  return 'none';
};
const panelOf = (name: string, panels: number, alpha: number, closed = true) => {
  const nodes = panelNodes(parseNaca(name), panels, closed);
  return vortexPanel(nodes.X, nodes.Y, alpha * DEG);
};

describe('NACA geometry', () => {
  it('gives the NACA 2412 half thickness at x/c = 0.3 (open trailing edge)', () => {
    expect(Math.abs(halfThickness(0.3, 0.12, false) - 0.060017)).toBeLessThan(1e-6);
  });

  it('closes the trailing edge only when asked', () => {
    expect(Math.abs(halfThickness(1, 0.12, true))).toBeLessThan(1e-12);
    // 5 t (0.2969 − 0.1260 − 0.3516 + 0.2843 − 0.1015) = 0.6 × 0.0021.
    rel(halfThickness(1, 0.12, false), 0.00126, 1e-9);
  });

  it('reads the designation, with or without the letters', () => {
    const s = parseNaca(' naca 2412 ');
    expect([s.m, s.p, s.t, s.family]).toEqual([0.02, 0.4, 0.12, 'four']);
    expect(parseNaca('NACA-0012').m).toBe(0);
    const c = customSection(0.02, 0.4, 0.12);
    expect(c.camber(0.3)).toBe(s.camber(0.3));
  });

  it('puts the four-digit maximum camber at p, with the thickness normal to the camber line', () => {
    const s = parseNaca('2412');
    rel(s.camber(0.4), 0.02, 1e-12);
    expect(Math.abs(s.slope(0.4))).toBeLessThan(1e-15);
    const q = surfaceAt(s, 0.2, true);
    const yt = halfThickness(0.2, 0.12, true);
    rel(Math.hypot(q.xU - 0.2, q.yU - s.camber(0.2)), yt, 1e-12);
    rel(q.yU - q.yL, 2 * yt * Math.cos(Math.atan(s.slope(0.2))), 1e-12);
  });

  it('builds the 23012 and reflexed 23112 camber lines from the tabulated constants', () => {
    const a = parseNaca('23012');
    // k₁/6 (x³ − 3 r x² + r²(3 − r) x) at x = 0.1, r = 0.2025, k₁ = 15.957.
    rel(a.camber(0.1), 0.017011487594531256, 1e-12);
    expect(Math.abs(a.camber(1))).toBeLessThan(1e-15);
    expect(Math.abs(a.p - 0.15)).toBeLessThan(2e-3);
    expect(a.cli).toBeCloseTo(0.3, 12);
    const b = parseNaca('23112');
    rel(b.camber(0.6), 0.0066270555234996704, 1e-12);
    expect(Math.abs(b.camber(1))).toBeLessThan(1e-15);
    expect(b.reflex).toBe(true);
  });

  it('agrees with what the five-digit constants mean: the camber peak at P/20 and a design cl of 0.3', () => {
    const r = { 1: 0.058, 2: 0.126, 3: 0.2025, 4: 0.29, 5: 0.391 } as const;
    for (const P of [1, 2, 3, 4, 5] as const) {
      const p = P / 20;
      const root = brent((x) => 3 * p * p - 6 * x * p + x * x * (3 - x), p, 1).root;
      expect(Math.abs(root - r[P]) / root, `r for 2${P}0`).toBeLessThan(5e-3);
      const s = parseNaca(`2${P}012`);
      const thin = thinAirfoil(s, 0);
      // The design (ideal) lift coefficient is π A₁; NACA's rounded k₁ give it within a few per cent.
      expect(Math.abs((Math.PI * thin.A1) / 0.3 - 1), `cl for 2${P}0`).toBeLessThan(0.04);
    }
  });
});

describe('thin airfoil theory', () => {
  it('gives the NACA 2412 zero-lift angle and quarter-chord moment', () => {
    const r = thinAirfoil(parseNaca('2412'), 0);
    expect(Math.abs(r.alphaL0 / DEG - -2.0772)).toBeLessThan(1e-3);
    expect(Math.abs(r.cmQuarter - -0.05312)).toBeLessThan(1e-4);
    // More digits from scipy.integrate.quad (scratch foil.py).
    rel(r.alphaL0 / DEG, -2.077240404903986, 1e-9);
    rel(r.A1, 0.08149514160085629, 1e-9);
    rel(r.A2, 0.013861276466376467, 1e-9);
    rel(r.cmQuarter, -0.05311951346009116, 1e-9);
  });

  it('gives a flat plate cl = 2πα', () => {
    const r = thinAirfoil(parseNaca('0000'), 5 * DEG);
    expect(Math.abs(r.cl - 0.54831)).toBeLessThan(1e-5);
    expect(r.alphaL0).toBe(0);
    expect(r.cmQuarter).toBe(0);
    expect(r.xcp).toBeCloseTo(0.25, 12);
  });

  it('scales linearly with camber, and gives the 23012 values', () => {
    rel(thinAirfoil(parseNaca('4412'), 0).alphaL0 / DEG, -4.154480809807972, 1e-9);
    const r = thinAirfoil(parseNaca('23012'), 0);
    rel(r.alphaL0 / DEG, -1.0935866685928142, 1e-8);
    rel(r.cmQuarter, -0.012835664520068863, 1e-8);
    // The reflexed line was designed for almost no quarter-chord moment.
    expect(Math.abs(thinAirfoil(parseNaca('23112'), 0).cmQuarter)).toBeLessThan(2e-3);
  });

  it('holds the textbook identities: cl = π(2A₀ + A₁), and cm,LE = cm,c/4 − cl/4', () => {
    const r = thinAirfoil(parseNaca('2412'), 6 * DEG);
    rel(r.cl, Math.PI * (2 * r.A0 + r.A1), 1e-12);
    rel(r.cmLE, r.cmQuarter - r.cl / 4, 1e-12);
    // A camber line with a constant slope k gives ∫ k (cos θ − 1) dθ = −π k exactly.
    const sloped = { ...parseNaca('0012'), slope: () => 0.1 };
    rel(
      camberIntegral(sloped, (t) => Math.cos(t) - 1, 0),
      -0.1 * Math.PI,
      1e-12,
    );
  });
});

describe('vortex panel method', () => {
  it('gives NACA 0012 no lift and symmetric pressures at zero incidence', () => {
    const r = panelOf('0012', 160, 0);
    expect(Math.abs(r.cl)).toBeLessThan(1e-6);
    const n = r.cp.length;
    for (let i = 0; i < n; i += 1) expect(Math.abs(r.cp[i]! - r.cp[n - 1 - i]!)).toBeLessThan(1e-6);
  });

  it('gives NACA 0012 at 5° about 0.60, converged as the panels double', () => {
    const a = panelOf('0012', 160, 5);
    expect(Math.abs(a.cl - 0.6)).toBeLessThan(0.03);
    expect(a.cl).toBeGreaterThan(2 * Math.PI * 5 * DEG);
    // The separate Python panel code (scratch panel.py) gives 0.6029337389 with 160 panels.
    rel(a.cl, 0.6029337389393754, 1e-8);
    const b = panelOf('0012', 320, 5);
    expect(Math.abs(b.cl - a.cl) / a.cl).toBeLessThan(0.005);
    rel(panelOf('0012', 160, -5).cl, -a.cl, 1e-9);
  });

  it('matches the separate code on a cambered section, and the pressures agree with the circulation', () => {
    const r = panelOf('2412', 120, 4);
    rel(r.cl, 0.7414047718797598, 1e-8);
    rel(r.clPressure, 0.7356307744065265, 1e-8);
    rel(r.cm, -0.06144855818384336, 1e-7);
    expect(Math.abs(r.clPressure - r.cl) / r.cl).toBeLessThan(0.01);
    expect(r.stagnation?.lower).toBe(true);
    expect(r.stagnation!.x).toBeLessThan(0.01);
  });

  it('matches the exact lift of a Joukowski airfoil', () => {
    // Circle of radius a = 1 + e about (−e, 0), mapped by z = ζ + 1/ζ; φ runs clockwise from the cusp at z = 2.
    const e = 0.1;
    const a = 1 + e;
    const n = 240;
    const X: number[] = [];
    const Y: number[] = [];
    for (let k = 0; k <= n; k += 1) {
      const phi = (-2 * Math.PI * k) / n;
      const [zr, zi] = [-e + a * Math.cos(phi), a * Math.sin(phi)];
      const d = zr * zr + zi * zi;
      X.push(zr + zr / d);
      Y.push(zi - zi / d);
    }
    const lead = -(1 + 2 * e) - 1 / (1 + 2 * e);
    const chord = 2 - lead;
    const alpha = 5 * DEG;
    const exact = (8 * Math.PI * a * Math.sin(alpha)) / chord;
    const r = vortexPanel(X, Y, alpha, chord, { x: lead + chord / 4, y: 0 });
    expect(Math.abs(r.cl - exact) / exact).toBeLessThan(0.01);
  });
});

describe('the airfoil engine', () => {
  const base = { section: parseNaca('2412'), alpha: 4, panels: 120, closed: true };

  it('runs thin airfoil theory and panels together, with the coordinates at the NACA stations', () => {
    const r = airfoil(base);
    rel(r.thin.cl, 2 * Math.PI * (4 + 2.077240404903986) * DEG, 1e-9);
    rel(r.panel!.cl, 0.7414047718797598, 1e-8);
    expect(r.table.length).toBe(18);
    expect(r.table[0]).toEqual({ x: 0, xU: 0, yU: 0, xL: 0, yL: 0 });
    expect(r.steps.map((s) => s.key)).toContain('afPanelCl');
  });

  it('skips the panels for a flat plate', () => {
    const r = airfoil({ ...base, section: parseNaca('0000'), alpha: 5 });
    expect(r.panel).toBeUndefined();
    expect(r.steps.map((s) => s.key)).toContain('afSlopeFlat');
  });

  it('keeps going at huge angles, which are only inviscid answers', () => {
    const r = airfoil({ ...base, alpha: 80 });
    expect(Number.isFinite(r.panel!.cl)).toBe(true);
  });

  it('refuses impossible inputs with a reason', () => {
    expect(code(() => parseNaca('24x2'))).toBe('nacaCode');
    expect(code(() => parseNaca('123'))).toBe('nacaCode');
    expect(code(() => parseNaca('2012'))).toBe('camberAtNose');
    expect(code(() => parseNaca('0412'))).toBe('positionWithoutCamber');
    expect(code(() => parseNaca('03012'))).toBe('fiveDigitLift');
    expect(code(() => parseNaca('26012'))).toBe('fiveDigitLine');
    expect(code(() => parseNaca('23212'))).toBe('fiveDigitLine');
    expect(code(() => parseNaca('21112'))).toBe('fiveDigitLine');
    expect(code(() => parseNaca('2450'))).toBe('thicknessRange');
    expect(code(() => customSection(0.2, 0.4, 0.12))).toBe('camberRange');
    expect(code(() => customSection(0.02, 1, 0.12))).toBe('positionRange');
    expect(code(() => customSection(0.02, 0.4, -0.1))).toBe('thicknessRange');
    expect(code(() => customSection(Number.NaN, 0.4, 0.1))).toBe('notNumber');
    for (const panels of [21, 10, 1000, 120.5]) expect(code(() => airfoil({ ...base, panels }))).toBe('panelCount');
    expect(code(() => airfoil({ ...base, alpha: Number.NaN }))).toBe('notNumber');
  });
});
